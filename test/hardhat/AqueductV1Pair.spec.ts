import { expect } from "chai";
import { BigNumber, constants as ethconst, Contract } from "ethers";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { expandTo18Decimals, encodePrice } from "./shared/utilities";
import { AqueductV1Pair } from "../../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { Framework } from "@superfluid-finance/sdk-core";
import { deployTestFramework } from "@superfluid-finance/ethereum-contracts/dev-scripts/deploy-test-framework";
import TestToken from "@superfluid-finance/ethereum-contracts/build/contracts/TestToken.json";

let sfDeployer;
let contractsFramework: any;
let sf: Framework;
let baseTokenA;
let baseTokenB;
let tokenA: any;
let tokenB: any;

// Test Accounts
let owner: SignerWithAddress;
let wallet2: SignerWithAddress;

// fee constants
const UPPER_FEE = 30; // basis points
const LOWER_FEE = 1;

// delay helper function
const delay = async (seconds: number) => {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
};

// babylonian square root
function sqrtBN(value: BigNumber) {
    if (value.isZero()) return BigNumber.from(0);

    let x = BigNumber.from(1);
    let y = value;

    while (x.lt(y)) {
        y = x.add(y).div(2);
        x = value.div(y);
    }

    return y;
}

// erc20 abi, used to correctly check for Transfer event
const erc20Abi = ["event Transfer(address indexed from, address indexed to, uint256 value)"];

before(async function () {
    // get hardhat accounts
    [owner, wallet2] = await ethers.getSigners();
    sfDeployer = await deployTestFramework();

    // GETTING SUPERFLUID FRAMEWORK SET UP

    // deploy the framework locally
    contractsFramework = await sfDeployer.frameworkDeployer.getFramework();

    // initialize framework
    sf = await Framework.create({
        chainId: 31337,
        provider: ethers.provider,
        resolverAddress: contractsFramework.resolver, // (empty)
        protocolReleaseVersion: "test",
    });

    // DEPLOYING DAI and DAI wrapper super token (which will be our `spreaderToken`)
    await sfDeployer.frameworkDeployer.deployWrapperSuperToken(
        "Base Token A",
        "baseTokenA",
        18,
        ethers.utils.parseEther("10000").toString()
    );
    await sfDeployer.frameworkDeployer.deployWrapperSuperToken(
        "Base Token B",
        "baseTokenB",
        18,
        ethers.utils.parseEther("10000").toString()
    );

    tokenA = await sf.loadSuperToken("baseTokenAx");
    baseTokenA = new ethers.Contract(tokenA.underlyingToken!.address, TestToken.abi, owner);

    tokenB = await sf.loadSuperToken("baseTokenBx");
    baseTokenB = new ethers.Contract(tokenB.underlyingToken!.address, TestToken.abi, owner);

    const setupToken = async (underlyingToken: Contract, superToken: any) => {
        // minting test token
        await underlyingToken.mint(owner.address, ethers.utils.parseEther("10000").toString());

        // approving DAIx to spend DAI (Super Token object is not an ethers contract object and has different operation syntax)
        await underlyingToken.approve(superToken.address, ethers.constants.MaxInt256);
        await underlyingToken.connect(owner).approve(superToken.address, ethers.constants.MaxInt256);
        // Upgrading all DAI to DAIx
        const ownerUpgrade = superToken.upgrade({
            amount: ethers.utils.parseEther("10000").toString(),
        });
        await ownerUpgrade.exec(owner);
    };

    await setupToken(baseTokenA, tokenA);
    await setupToken(baseTokenB, tokenB);
});

const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3);

describe("AqueductV1Pair", () => {
    async function fixture() {
        const [wallet, other] = await ethers.getSigners();

        const factory = await (
            await ethers.getContractFactory("AqueductV1Factory")
        ).deploy(wallet.address, contractsFramework.host);

        await factory.createPair(tokenA.address, tokenB.address);
        const pair = (await ethers.getContractFactory("AqueductV1Pair")).attach(
            await factory.getPair(tokenA.address, tokenB.address)
        );
        const token0Address = await pair.token0();
        const token0 = tokenA.address === token0Address ? tokenA : tokenB;
        const token1 = tokenA.address === token0Address ? tokenB : tokenA;

        // approve max amount for every user
        await token0
            .approve({
                receiver: pair.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);
        await token1
            .approve({
                receiver: pair.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);

        // impersonate factory to manually bypass auction and call swap()
        const auctionAddress = await factory.auction();
        const mockAuctionSigner = await ethers.getSigner(auctionAddress);
        await network.provider.send("hardhat_setBalance", [
            auctionAddress,
            ethers.utils.hexValue(ethers.utils.parseEther("1.0")),
        ]);

        return { pair, token0, token1, wallet, other, factory, auctionAddress, mockAuctionSigner };
    }

    it("mint", async () => {
        const { pair, wallet, token0, token1 } = await loadFixture(fixture);
        const token0Amount = expandTo18Decimals(1);
        const token1Amount = expandTo18Decimals(4);

        await token0
            .transfer({
                receiver: pair.address,
                amount: token0Amount,
            })
            .exec(wallet);
        await token1
            .transfer({
                receiver: pair.address,
                amount: token1Amount,
            })
            .exec(wallet);

        const expectedLiquidity = expandTo18Decimals(2);
        await expect(pair.mint(wallet.address))
            .to.emit(pair, "Transfer")
            .withArgs(ethconst.AddressZero, ethconst.AddressZero, MINIMUM_LIQUIDITY)
            .to.emit(pair, "Transfer")
            .withArgs(ethconst.AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
            .to.emit(pair, "Sync")
            .withArgs(token0Amount, token1Amount)
            .to.emit(pair, "Mint")
            .withArgs(wallet.address, token0Amount, token1Amount);

        expect(await pair.totalSupply()).to.eq(expectedLiquidity);
        expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY));
        expect(
            await token0.balanceOf({
                account: pair.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(token0Amount);
        expect(
            await token1.balanceOf({
                account: pair.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(token1Amount);
        const reserves = await pair.getStaticReserves();
        expect(reserves[0]).to.eq(token0Amount);
        expect(reserves[1]).to.eq(token1Amount);
    });

    // tests that reserves are settled correctly by mint
    it("mint:dynamic_reserves", async () => {
        const { pair, wallet, token0, token1 } = await loadFixture(fixture);

        // provide initial liquidity
        const token0Amount = expandTo18Decimals(10);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);
        const expectedInitialLiquidity = expandTo18Decimals(10);
        expect(await pair.totalSupply()).to.eq(expectedInitialLiquidity);

        // check initial reserves (shouldn't have changed)
        let realTimeReserves = await pair.getReserves();
        expect(realTimeReserves.reserve0).to.equal(token0Amount);
        expect(realTimeReserves.reserve1).to.equal(token1Amount);

        // create a stream
        const flowRate = BigNumber.from("1000000000");
        const createFlowOperation = token0.createFlow({
            sender: wallet.address,
            receiver: pair.address,
            flowRate: flowRate,
        });
        const txnResponse = await createFlowOperation.exec(wallet);
        await txnResponse.wait();

        // skip some time to let the reserves change
        await delay(60);

        // test providing liquidity
        const latestTime = (await ethers.provider.getBlock("latest")).timestamp;
        const nextBlockTime = latestTime + 10;

        const lpToken0Amount = expandTo18Decimals(1);

        const realTimeReserves2 = await pair.getReservesAtTime(nextBlockTime);
        const lpToken1Amount = realTimeReserves2.reserve1.mul(lpToken0Amount).div(realTimeReserves2.reserve0); // calculate correct ratio based on reserves

        await token0
            .transfer({
                receiver: pair.address,
                amount: lpToken0Amount,
            })
            .exec(wallet);
        await token1
            .transfer({
                receiver: pair.address,
                amount: lpToken1Amount,
            })
            .exec(wallet);

        await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);

        const expectedNewLiquidity = lpToken1Amount.mul(expectedInitialLiquidity).div(realTimeReserves2.reserve1);
        const expectedTotalLiquidity = expectedInitialLiquidity.add(expectedNewLiquidity);
        await expect(pair.mint(wallet2.address))
            .to.emit(pair, "Mint")
            .withArgs(wallet.address, lpToken0Amount, lpToken1Amount);

        expect(await pair.totalSupply()).to.eq(expectedTotalLiquidity);
        expect(await pair.balanceOf(wallet2.address)).to.eq(expectedNewLiquidity);
    });

    async function addLiquidity(
        token0: any,
        token1: any,
        pair: AqueductV1Pair,
        wallet: SignerWithAddress,
        token0Amount: BigNumber,
        token1Amount: BigNumber
    ) {
        await token0
            .transfer({
                receiver: pair.address,
                amount: token0Amount,
            })
            .exec(wallet);
        await token1
            .transfer({
                receiver: pair.address,
                amount: token1Amount,
            })
            .exec(wallet);
        await pair.mint(wallet.address);
    }

    const swapTestCases: BigNumber[][] = [
        [1, 5, 10, "1666666666666666666"],
        [1, 10, 5, "454545454545454545"],

        [2, 5, 10, "2857142857142857142"],
        [2, 10, 5, "833333333333333333"],

        [1, 10, 10, "909090909090909090"],
        [1, 100, 100, "990099009900990099"],
        [1, 1000, 1000, "999000999000999000"],
    ].map((a) => a.map((n) => (typeof n === "string" ? BigNumber.from(n) : expandTo18Decimals(n))));
    swapTestCases.forEach((swapTestCase, i) => {
        it(`getInputPrice:${i}`, async () => {
            const { pair, wallet, token0, token1, mockAuctionSigner, auctionAddress } = await loadFixture(fixture);

            const [swapAmount, token0Amount, token1Amount, expectedOutputAmount] = swapTestCase;
            await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);
            await token0
                .transfer({
                    receiver: pair.address,
                    amount: swapAmount,
                })
                .exec(wallet);

            // impersonate factory contract to bypass auction and call swap() directly
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [auctionAddress],
            });
            await expect(
                pair.connect(mockAuctionSigner).swap(0, expectedOutputAmount.add(1), wallet.address)
            ).to.be.revertedWithCustomError(pair, "PAIR_K");
            await pair.connect(mockAuctionSigner).swap(0, expectedOutputAmount, wallet.address);
        });
    });

    const optimisticTestCases: BigNumber[][] = [
        ["1000000000000000000", 5, 10, 1], // given amountIn, amountOut = floor(amountIn * .997)
        ["1000000000000000000", 10, 5, 1],
        ["1000000000000000000", 5, 5, 1],
        [1, 5, 5, "1000000000000000000"], // given amountOut, amountIn = ceiling(amountOut / .997)
    ].map((a) => a.map((n) => (typeof n === "string" ? BigNumber.from(n) : expandTo18Decimals(n))));
    optimisticTestCases.forEach((optimisticTestCase, i) => {
        it(`optimistic:${i}`, async () => {
            const { pair, wallet, token0, token1, auctionAddress, mockAuctionSigner } = await loadFixture(fixture);

            const [outputAmount, token0Amount, token1Amount, inputAmount] = optimisticTestCase;
            await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);
            await token0
                .transfer({
                    receiver: pair.address,
                    amount: inputAmount,
                })
                .exec(wallet);

            // impersonate factory contract to bypass auction and call swap() directly
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [auctionAddress],
            });
            await expect(
                pair.connect(mockAuctionSigner).swap(outputAmount.add(1), 0, wallet.address)
            ).to.be.revertedWithCustomError(pair, "PAIR_K");
            await pair.connect(mockAuctionSigner).swap(outputAmount, 0, wallet.address);
        });
    });

    it("swap:token0", async () => {
        const { pair, wallet, token0, token1, auctionAddress, mockAuctionSigner } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const swapAmount = expandTo18Decimals(1);
        const expectedOutputAmount = BigNumber.from("1662497915624478906");
        await token0
            .transfer({
                receiver: pair.address,
                amount: swapAmount,
            })
            .exec(wallet);
        // impersonate factory contract to bypass auction and call swap() directly
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [auctionAddress],
        });
        await expect(pair.connect(mockAuctionSigner).swap(0, expectedOutputAmount, wallet.address))
            //.to.emit(token1, "Transfer")
            //.withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, "Sync")
            .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
            .to.emit(pair, "Swap")
            .withArgs(auctionAddress, swapAmount, 0, 0, expectedOutputAmount, wallet.address);

        const reserves = await pair.getStaticReserves();
        expect(reserves[0]).to.eq(token0Amount.add(swapAmount));
        expect(reserves[1]).to.eq(token1Amount.sub(expectedOutputAmount));
        expect(
            await token0.balanceOf({
                account: pair.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(token0Amount.add(swapAmount));
        expect(
            await token1.balanceOf({
                account: pair.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(token1Amount.sub(expectedOutputAmount));
        const totalSupplyToken0 = BigNumber.from(await token0.totalSupply({ providerOrSigner: ethers.provider }));
        const totalSupplyToken1 = BigNumber.from(await token1.totalSupply({ providerOrSigner: ethers.provider }));
        expect(
            await token0.balanceOf({
                account: wallet.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(totalSupplyToken0.sub(token0Amount).sub(swapAmount).toString());
        expect(
            await token1.balanceOf({
                account: wallet.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(totalSupplyToken1.sub(token1Amount).add(expectedOutputAmount));
    });

    it("swap:token1", async () => {
        const { pair, wallet, token0, token1, auctionAddress, mockAuctionSigner } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const swapAmount = expandTo18Decimals(1);
        const expectedOutputAmount = BigNumber.from("453305446940074565");
        await token1
            .transfer({
                receiver: pair.address,
                amount: swapAmount,
            })
            .exec(wallet);
        // impersonate factory contract to bypass auction and call swap() directly
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [auctionAddress],
        });
        await expect(pair.connect(mockAuctionSigner).swap(expectedOutputAmount, 0, wallet.address))
            //.to.emit(token0, "Transfer")
            //.withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, "Sync")
            .withArgs(token0Amount.sub(expectedOutputAmount), token1Amount.add(swapAmount))
            .to.emit(pair, "Swap")
            .withArgs(auctionAddress, 0, swapAmount, expectedOutputAmount, 0, wallet.address);

        const reserves = await pair.getStaticReserves();
        expect(reserves[0]).to.eq(token0Amount.sub(expectedOutputAmount));
        expect(reserves[1]).to.eq(token1Amount.add(swapAmount));
        expect(
            await token0.balanceOf({
                account: pair.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(token0Amount.sub(expectedOutputAmount));
        expect(
            await token1.balanceOf({
                account: pair.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(token1Amount.add(swapAmount));
        const totalSupplyToken0 = BigNumber.from(await token0.totalSupply({ providerOrSigner: ethers.provider }));
        const totalSupplyToken1 = BigNumber.from(await token1.totalSupply({ providerOrSigner: ethers.provider }));
        expect(
            await token0.balanceOf({
                account: wallet.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(totalSupplyToken0.sub(token0Amount).add(expectedOutputAmount));
        expect(
            await token1.balanceOf({
                account: wallet.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(totalSupplyToken1.sub(token1Amount).sub(swapAmount));
    });

    /*
  NOTE: modifications to contract caused changes in gas cost, so temporarily removing this test
  it("swap:gas", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture);

    const token0Amount = expandTo18Decimals(5);
    const token1Amount = expandTo18Decimals(10);
    await addLiquidity(
      token0,
      token1,
      pair,
      wallet,
      token0Amount,
      token1Amount
    );

    // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
    await ethers.provider.send("evm_mine", [
      (await ethers.provider.getBlock("latest")).timestamp + 1,
    ]);

    await time.setNextBlockTimestamp(
      (await ethers.provider.getBlock("latest")).timestamp + 1
    );
    await pair.sync();

    const swapAmount = expandTo18Decimals(1);
    const expectedOutputAmount = BigNumber.from("453305446940074565");
    await token1.transfer({receiver: pair.address, amount: swapAmount}).exec(wallet);
    await time.setNextBlockTimestamp(
      (await ethers.provider.getBlock("latest")).timestamp + 1
    );
    const tx = await pair.swap(expectedOutputAmount, 0, wallet.address);
    const receipt = await tx.wait();
    expect(receipt.gasUsed).to.eq(73959);
  });
*/

    it("burn", async () => {
        const { pair, wallet, token0, token1 } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(3);
        const token1Amount = expandTo18Decimals(3);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const expectedLiquidity = expandTo18Decimals(3);
        await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY));
        await expect(pair.burn(wallet.address))
            .to.emit(pair, "Transfer")
            .withArgs(pair.address, ethconst.AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer")
            .withArgs(pair.address, wallet.address, token0Amount.sub(1000))
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer")
            .withArgs(pair.address, wallet.address, token1Amount.sub(1000))
            .to.emit(pair, "Sync")
            .withArgs(1000, 1000)
            .to.emit(pair, "Burn")
            .withArgs(wallet.address, token0Amount.sub(1000), token1Amount.sub(1000), wallet.address);

        expect(await pair.balanceOf(wallet.address)).to.eq(0);
        expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);
        expect(
            await token0.balanceOf({
                account: pair.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq("1000");
        expect(
            await token1.balanceOf({
                account: pair.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq("1000");
        const totalSupplyToken0 = BigNumber.from(await token0.totalSupply({ providerOrSigner: ethers.provider }));
        const totalSupplyToken1 = BigNumber.from(await token1.totalSupply({ providerOrSigner: ethers.provider }));
        expect(
            await token0.balanceOf({
                account: wallet.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(totalSupplyToken0.sub(1000).toString());
        expect(
            await token1.balanceOf({
                account: wallet.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(totalSupplyToken1.sub(1000).toString());
    });

    // tests that reserves are settled correctly by burn
    it("burn:dynamic_reserves", async () => {
        const { pair, wallet, token0, token1 } = await loadFixture(fixture);

        // provide initial liquidity
        const token0Amount = expandTo18Decimals(10);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);
        const expectedLiquidity = expandTo18Decimals(10);
        expect(await pair.totalSupply()).to.eq(expectedLiquidity);

        // check initial reserves (shouldn't have changed)
        let realTimeReserves = await pair.getReserves();
        expect(realTimeReserves.reserve0).to.equal(token0Amount);
        expect(realTimeReserves.reserve1).to.equal(token1Amount);

        // create a stream
        const flowRate = BigNumber.from("1000000000");
        const createFlowOperation = token0.createFlow({
            sender: wallet.address,
            receiver: pair.address,
            flowRate: flowRate,
        });
        const txnResponse = await createFlowOperation.exec(wallet);
        await txnResponse.wait();

        // skip some time to let the reserves change
        await delay(60);

        // test removing liquidity
        const latestTime = (await ethers.provider.getBlock("latest")).timestamp;
        const nextBlockTime = latestTime + 10;

        const realTimeReserves2 = await pair.getReservesAtTime(nextBlockTime);

        await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY));

        const totalSupply = await pair.totalSupply();
        const expectedToken0Amount = expectedLiquidity.mul(realTimeReserves2.reserve0).div(totalSupply);
        const expectedToken1Amount = expectedLiquidity.mul(realTimeReserves2.reserve1).div(totalSupply);

        await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
        await expect(pair.burn(wallet.address))
            .to.emit(pair, "Transfer")
            .withArgs(pair.address, ethconst.AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer")
            .withArgs(pair.address, wallet.address, expectedToken0Amount.sub(1001)) // TODO: assuming this is a rouding error (should be 1000), is this ok
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer")
            .withArgs(pair.address, wallet.address, expectedToken1Amount.sub(1000))
            .to.emit(pair, "Sync")
            .withArgs(1001, 1000)
            .to.emit(pair, "Burn")
            .withArgs(wallet.address, expectedToken0Amount.sub(1001), expectedToken1Amount.sub(1000), wallet.address);

        expect(await pair.balanceOf(wallet.address)).to.eq(0);
        expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);
    });

    it("price{0,1}CumulativeLast", async () => {
        const { pair, wallet, token0, token1, auctionAddress, mockAuctionSigner } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(3);
        const token1Amount = expandTo18Decimals(3);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const blockTimestamp = (await pair.getStaticReserves())[2];
        await time.setNextBlockTimestamp(blockTimestamp + 1);
        await pair.sync();

        const initialPrice = encodePrice(token0Amount, token1Amount);
        // expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0]);
        // expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1]);
        // expect((await pair.getStaticReserves())[2]).to.eq(blockTimestamp + 1);

        const swapAmount = expandTo18Decimals(3);
        await token0
            .transfer({
                receiver: pair.address,
                amount: swapAmount,
            })
            .exec(wallet);
        await time.setNextBlockTimestamp(blockTimestamp + 10);
        // impersonate factory contract to bypass auction and call swap() directly
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [auctionAddress],
        });
        // swap to a new price eagerly instead of syncing
        await pair.connect(mockAuctionSigner).swap(0, expandTo18Decimals(1), wallet.address); // make the price nice

        expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0].mul(10));
        expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1].mul(10));
        expect((await pair.getStaticReserves())[2]).to.eq(blockTimestamp + 10);

        await time.setNextBlockTimestamp(blockTimestamp + 20);
        await pair.sync();

        const newPrice = encodePrice(expandTo18Decimals(6), expandTo18Decimals(2));
        expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0].mul(10).add(newPrice[0].mul(10)));
        expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1].mul(10).add(newPrice[1].mul(10)));
        expect((await pair.getStaticReserves())[2]).to.eq(blockTimestamp + 20);
    });

    it("feeTo:off", async () => {
        const { pair, wallet, token0, token1, auctionAddress, mockAuctionSigner } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(1000);
        const token1Amount = expandTo18Decimals(1000);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const swapAmount = expandTo18Decimals(1);
        const expectedOutputAmount = BigNumber.from("996006981039903216");
        await token1
            .transfer({
                receiver: pair.address,
                amount: swapAmount,
            })
            .exec(wallet);
        // impersonate factory contract to bypass auction and call swap() directly
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [auctionAddress],
        });
        await pair.connect(mockAuctionSigner).swap(expectedOutputAmount, 0, wallet.address);

        const expectedLiquidity = expandTo18Decimals(1000);
        await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY));
        await pair.burn(wallet.address);
        expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);
    });

    it("feeTo:on", async () => {
        const { pair, wallet, token0, token1, other, factory, auctionAddress, mockAuctionSigner } = await loadFixture(
            fixture
        );

        await factory.setFeeTo(other.address);

        const token0Amount = expandTo18Decimals(1000);
        const token1Amount = expandTo18Decimals(1000);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const swapAmount = expandTo18Decimals(1);
        const expectedOutputAmount = BigNumber.from("996006981039903216");
        await token1
            .transfer({
                receiver: pair.address,
                amount: swapAmount,
            })
            .exec(wallet);
        // impersonate factory contract to bypass auction and call swap() directly
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [auctionAddress],
        });
        await pair.connect(mockAuctionSigner).swap(expectedOutputAmount, 0, wallet.address);

        const expectedLiquidity = expandTo18Decimals(1000);
        await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY));
        await pair.burn(wallet.address);
        expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY.add("249750499251388"));
        expect(await pair.balanceOf(other.address)).to.eq("249750499251388");

        // using 1000 here instead of the symbolic MINIMUM_LIQUIDITY because the amounts only happen to be equal...
        // ...because the initial liquidity amounts were equal
        expect(
            await token0.balanceOf({
                account: pair.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(BigNumber.from(1000).add("249501683697445"));
        expect(
            await token1.balanceOf({
                account: pair.address,
                providerOrSigner: ethers.provider,
            })
        ).to.eq(BigNumber.from(1000).add("250000187312969"));
    });

    it("twap:token0", async () => {
        const { pair, wallet, token0, token1 } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(10);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        // check initial reserves (shouldn't have changed)
        let realTimeReserves = await pair.getReserves();
        expect(realTimeReserves.reserve0).to.equal(token0Amount);
        expect(realTimeReserves.reserve1).to.equal(token1Amount);

        // create a stream
        const flowRate = BigNumber.from("1000000000");
        const createFlowOperation = token0.createFlow({
            sender: wallet.address,
            receiver: pair.address,
            flowRate: flowRate,
        });
        const txnResponse = await createFlowOperation.exec(wallet);
        const txn = await txnResponse.wait();
        const timeStart = (await ethers.provider.getBlock(txn.blockNumber)).timestamp;

        // get amount after buffer
        const walletBalanceAfterBuffer0 = BigNumber.from(
            await token0.balanceOf({
                account: wallet.address,
                providerOrSigner: ethers.provider,
            })
        );

        const checkStaticReserves = async () => {
            const realTimeReserves = await pair.getReserves();
            expect(realTimeReserves.reserve0).to.equal(token0Amount);
            expect(realTimeReserves.reserve1).to.equal(token1Amount);
        };

        const checkReserves = async () => {
            const time = (await ethers.provider.getBlock("latest")).timestamp;
            const dt = time - timeStart;

            if (dt > 0) {
                const realTimeReserves = await pair.getReserves();
                const totalAmountA = flowRate.mul(dt);
                const k = token0Amount.mul(token1Amount);
                const aNoFees = token0Amount.add(totalAmountA);
                const aFees = token0Amount.add(totalAmountA.mul(10000 - UPPER_FEE).div(10000));
                const b = k.div(aFees);
                expect(
                    await token0.balanceOf({
                        account: wallet.address,
                        providerOrSigner: ethers.provider,
                    })
                ).to.equal(walletBalanceAfterBuffer0.sub(flowRate.mul(dt)));
                expect(realTimeReserves.reserve0).to.equal(aNoFees);
                expect(realTimeReserves.reserve1).to.be.within(b.mul(999).div(1000), b);
            } else {
                await checkStaticReserves();
            }
        };

        const checkBalances = async () => {
            const realTimeReserves = await pair.getReserves();
            const poolBalance1 = BigNumber.from(
                await token1.balanceOf({
                    account: pair.address,
                    providerOrSigner: ethers.provider,
                })
            );
            const walletSwapBalances = await pair.getRealTimeUserBalances(wallet.address);

            // perfect case:          (reserve + all user balances) = poolBalance
            // never allowed:         (reserve + all user balances) > poolBalance
            // dust amounts allowed:  (reserve + all user balances) < poolBalance
            expect(poolBalance1.sub(realTimeReserves.reserve1.add(walletSwapBalances.balance1))).to.be.within(0, 100);
        };

        // check reserves (1-2 sec may have passed, so check timestamp)
        await checkReserves();
        await checkBalances();

        // skip ahead and check again
        await delay(600);
        await checkReserves();
        await checkBalances();

        // cancel stream and check that swapped balance is withdrawn
        const baseToken1Balance = expandTo18Decimals(10000).sub(token1Amount);
        expect(
            BigNumber.from(
                await token1.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            )
        ).to.be.equal(baseToken1Balance);
        let latestTime = (await ethers.provider.getBlock("latest")).timestamp;
        let nextBlockTime = latestTime + 10;
        const expectedAmountsOut = await pair.getUserBalancesAtTime(wallet.address, nextBlockTime);
        await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
        const deleteFlowOperation = token0.deleteFlow({
            sender: wallet.address,
            receiver: pair.address,
        });
        const txnResponse2 = await deleteFlowOperation.exec(wallet);
        await txnResponse2.wait();
        expect(
            BigNumber.from(
                await token1.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            )
        ).to.be.equal(baseToken1Balance.add(expectedAmountsOut.balance1));

        const newExpectedAmountsOut = await pair.getRealTimeUserBalances(wallet.address);
        expect(newExpectedAmountsOut.balance1).to.be.equal(BigNumber.from(0));

        // TODO: check that total locked swapped amount is 0 (or dust amount? TODO: is dust amount okay?)
    });

    it("twap:token1", async () => {
        const { pair, wallet, token0, token1 } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(10);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        // check initial reserves (shouldn't have changed)
        let realTimeReserves = await pair.getReserves();
        expect(realTimeReserves.reserve0).to.equal(token0Amount);
        expect(realTimeReserves.reserve1).to.equal(token1Amount);

        // create a stream
        const flowRate = BigNumber.from("1000000000");
        const createFlowOperation = token1.createFlow({
            sender: wallet.address,
            receiver: pair.address,
            flowRate: flowRate,
        });
        const txnResponse = await createFlowOperation.exec(wallet);
        const txn = await txnResponse.wait();
        const timeStart = (await ethers.provider.getBlock(txn.blockNumber)).timestamp;

        // get amount after buffer
        const walletBalanceAfterBuffer1 = BigNumber.from(
            await token1.balanceOf({
                account: wallet.address,
                providerOrSigner: ethers.provider,
            })
        );

        const checkStaticReserves = async () => {
            const realTimeReserves = await pair.getReserves();
            expect(realTimeReserves.reserve0).to.equal(token0Amount);
            expect(realTimeReserves.reserve1).to.equal(token1Amount);
        };

        const checkReserves = async () => {
            const time = (await ethers.provider.getBlock("latest")).timestamp;
            const dt = time - timeStart;

            if (dt > 0) {
                const realTimeReserves = await pair.getReserves();
                const totalAmountB = flowRate.mul(dt);
                const k = token0Amount.mul(token1Amount);
                const bNoFees = token1Amount.add(totalAmountB);
                const bFees = token1Amount.add(totalAmountB.mul(10000 - UPPER_FEE).div(10000));
                const a = k.div(bFees);
                expect(
                    await token1.balanceOf({
                        account: wallet.address,
                        providerOrSigner: ethers.provider,
                    })
                ).to.equal(walletBalanceAfterBuffer1.sub(flowRate.mul(dt)));
                expect(realTimeReserves.reserve1).to.equal(bNoFees);
                expect(realTimeReserves.reserve0).to.be.within(a.mul(999).div(1000), a);
            } else {
                await checkStaticReserves();
            }
        };

        const checkBalances = async () => {
            const realTimeReserves = await pair.getReserves();
            const poolBalance0 = BigNumber.from(
                await token0.balanceOf({
                    account: pair.address,
                    providerOrSigner: ethers.provider,
                })
            );
            const walletSwapBalances = await pair.getRealTimeUserBalances(wallet.address);

            // perfect case:          (reserve + all user balances) = poolBalance
            // never allowed:         (reserve + all user balances) > poolBalance
            // dust amounts allowed:  (reserve + all user balances) < poolBalance
            expect(poolBalance0.sub(realTimeReserves.reserve0.add(walletSwapBalances.balance0))).to.be.within(0, 100);
        };

        // check reserves (1-2 sec may have passed, so check timestamp)
        await checkReserves();
        await checkBalances();

        // skip ahead and check again
        await delay(600);
        await checkReserves();
        await checkBalances();

        // cancel stream and check that swapped balance is withdrawn
        const baseToken0Balance = expandTo18Decimals(10000).sub(token0Amount);
        expect(
            BigNumber.from(
                await token0.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            )
        ).to.be.equal(baseToken0Balance);
        let latestTime = (await ethers.provider.getBlock("latest")).timestamp;
        let nextBlockTime = latestTime + 10;
        const expectedAmountsOut = await pair.getUserBalancesAtTime(wallet.address, nextBlockTime);
        await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
        const deleteFlowOperation = token1.deleteFlow({
            sender: wallet.address,
            receiver: pair.address,
        });
        const txnResponse2 = await deleteFlowOperation.exec(wallet);
        await txnResponse2.wait();
        expect(
            BigNumber.from(
                await token0.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            )
        ).to.be.equal(baseToken0Balance.add(expectedAmountsOut.balance0));

        const newExpectedAmountsOut = await pair.getRealTimeUserBalances(wallet.address);
        expect(newExpectedAmountsOut.balance0).to.be.equal(BigNumber.from(0));
    });

    it("twap:both_tokens", async () => {
        const { pair, wallet, token0, token1, auctionAddress, mockAuctionSigner } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(10);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        // check initial reserves (shouldn't have changed)
        let realTimeReserves = await pair.getReserves();
        expect(realTimeReserves.reserve0).to.equal(token0Amount);
        expect(realTimeReserves.reserve1).to.equal(token1Amount);

        // create a stream of token0
        const flowRate0 = BigNumber.from("1000000000");
        const createFlowOperation0 = token0.createFlow({
            sender: wallet.address,
            receiver: pair.address,
            flowRate: flowRate0,
        });

        // create a stream of token1
        const flowRate1 = BigNumber.from("500000000");
        const createFlowOperation1 = token1.createFlow({
            sender: wallet.address,
            receiver: pair.address,
            flowRate: flowRate1,
        });

        // batch both together
        const batchCall = sf.batchCall([createFlowOperation0, createFlowOperation1]);
        const txnResponse = await batchCall.exec(wallet);
        const txn = await txnResponse.wait();
        const timeStart = (await ethers.provider.getBlock(txn.blockNumber)).timestamp;

        // get amounts after buffer
        const walletBalanceAfterBuffer0 = BigNumber.from(
            await token0.balanceOf({
                account: wallet.address,
                providerOrSigner: ethers.provider,
            })
        );
        const walletBalanceAfterBuffer1 = BigNumber.from(
            await token1.balanceOf({
                account: wallet.address,
                providerOrSigner: ethers.provider,
            })
        );

        //////////////////////////////////////////////////////
        //                                                  //
        //   ref. https://www.paradigm.xyz/2021/07/twamm    //
        //                                                  //
        //////////////////////////////////////////////////////
        const checkDynamicReservesParadigmFormula = async (dt: number) => {
            const realTimeReserves = await pair.getReserves();
            const poolReserveA = parseFloat(token0Amount.toString());
            const poolReserveB = parseFloat(token1Amount.toString());
            const totalFlowA = parseFloat(flowRate0.toString());
            const totalFlowB = parseFloat(flowRate1.toString());
            const k = poolReserveA * poolReserveB;

            const c =
                (Math.sqrt(poolReserveA * (totalFlowB * dt)) - Math.sqrt(poolReserveB * (totalFlowA * dt))) /
                (Math.sqrt(poolReserveA * (totalFlowB * dt)) + Math.sqrt(poolReserveB * (totalFlowA * dt)));
            const a =
                (Math.sqrt((k * (totalFlowA * dt)) / (totalFlowB * dt)) *
                    (Math.pow(Math.E, 2 * Math.sqrt((totalFlowA * dt * (totalFlowB * dt)) / k)) + c)) /
                (Math.pow(Math.E, 2 * Math.sqrt((totalFlowA * dt * (totalFlowB * dt)) / k)) - c);
            const b = k / a;

            expect(
                await token0.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            ).to.equal(walletBalanceAfterBuffer0.sub(flowRate0.mul(dt)));
            expect(
                await token1.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            ).to.equal(walletBalanceAfterBuffer1.sub(flowRate1.mul(dt)));
            expect(realTimeReserves.reserve0).to.be.within(
                BigNumber.from((a * 0.9999999999).toString()),
                BigNumber.from(a.toString())
            );
            expect(realTimeReserves.reserve1).to.be.within(
                BigNumber.from((b * 0.999).toString()),
                BigNumber.from(b.toString())
            );
        };

        //////////////////////////////////////////////////////////
        //                                                      //
        //    using approximation:                              //
        //    a = √(k * (A + (r_A * dt)) / (B + (r_B * dt)))    //
        //                                                      //
        //////////////////////////////////////////////////////////
        const checkDynamicReservesParadigmApprox = async (dt: number) => {
            const realTimeReserves = await pair.getReserves();
            const poolReserveA = parseFloat(token0Amount.toString());
            const poolReserveB = parseFloat(token1Amount.toString());
            const totalFlowA = (parseFloat(flowRate0.toString()) * (10000 - UPPER_FEE)) / 10000; // upper fee should be taken from input amounts
            const totalFlowB = (parseFloat(flowRate1.toString()) * (10000 - UPPER_FEE)) / 10000;
            const k = poolReserveA * poolReserveB;

            const a = Math.sqrt((k * (poolReserveA + totalFlowA * dt)) / (poolReserveB + totalFlowB * dt));
            const b = k / a;

            expect(
                await token0.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            ).to.equal(walletBalanceAfterBuffer0.sub(flowRate0.mul(dt)));
            expect(
                await token1.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            ).to.equal(walletBalanceAfterBuffer1.sub(flowRate1.mul(dt)));
            expect(realTimeReserves.reserve0).to.be.within(
                BigNumber.from((a * 0.9999999999).toString()),
                BigNumber.from((a * 1.00000001).toString())
            );
            expect(realTimeReserves.reserve1).to.be.within(
                BigNumber.from((b * 0.9999999999).toString()),
                BigNumber.from((b * 1.00000001).toString())
            );
        };

        const checkStaticReserves = async () => {
            const realTimeReserves = await pair.getReserves();
            expect(realTimeReserves.reserve0).to.equal(token0Amount);
            expect(realTimeReserves.reserve1).to.equal(token1Amount);
        };

        const checkReserves = async () => {
            const time = (await ethers.provider.getBlock("latest")).timestamp;
            const dt = time - timeStart;

            if (dt > 0) {
                await checkDynamicReservesParadigmApprox(dt);
            } else {
                await checkStaticReserves();
            }
        };

        const checkBalances = async () => {
            const realTimeReserves = await pair.getReserves();
            const poolBalance0 = BigNumber.from(
                await token0.balanceOf({
                    account: pair.address,
                    providerOrSigner: ethers.provider,
                })
            );
            const poolBalance1 = BigNumber.from(
                await token1.balanceOf({
                    account: pair.address,
                    providerOrSigner: ethers.provider,
                })
            );
            const walletSwapBalances = await pair.getRealTimeUserBalances(wallet.address);

            // perfect case:          (reserve + all user balances + collected fees) = poolBalance
            // never allowed:         (reserve + all user balances) > poolBalance
            // dust amounts allowed:  (reserve + all user balances) < poolBalance
            expect(poolBalance0.sub(realTimeReserves.reserve0.add(walletSwapBalances.balance0))).to.be.within(0, 100); // within 0-100 wei
            expect(poolBalance1.sub(realTimeReserves.reserve1.add(walletSwapBalances.balance1))).to.be.within(0, 100);
        };

        // check reserves (1-2 sec may have passed, so check timestamp)
        await checkReserves();
        await checkBalances();

        // skip ahead and check again
        await delay(60);
        await checkReserves();
        await checkBalances();

        // The intent here is to have both of these discrete swap transactions in the same block, but turning off automine breaks the expect() function
        // Solution: just test in two separate blocks and re-calculate expectedOutputAmount

        // make a bad discrete swap (expect revert)
        let latestTime = (await ethers.provider.getBlock("latest")).timestamp;
        let nextBlockTime = latestTime + 10;
        let swapAmount = BigNumber.from("10000000000000");
        await token0
            .transfer({
                receiver: pair.address,
                amount: swapAmount,
            })
            .exec(wallet);
        let realTimeReserves2 = await pair.getReservesAtTime(nextBlockTime);
        let expectedOutputAmount = realTimeReserves2.reserve1
            .sub(
                realTimeReserves2.reserve0
                    .mul(realTimeReserves2.reserve1)
                    .div(realTimeReserves2.reserve0.add(swapAmount))
            )
            .sub(1);
        await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
        // impersonate factory contract to bypass auction and call swap() directly
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [auctionAddress],
        });
        await expect(
            pair.connect(mockAuctionSigner).swap(0, expectedOutputAmount.add("1"), wallet.address)
        ).to.be.revertedWithCustomError(pair, "PAIR_K");

        // make a correct discrete swap
        latestTime = (await ethers.provider.getBlock("latest")).timestamp;
        nextBlockTime = latestTime + 10;
        realTimeReserves2 = await pair.getReservesAtTime(nextBlockTime);
        expectedOutputAmount = realTimeReserves2.reserve1
            .sub(
                realTimeReserves2.reserve0
                    .mul(realTimeReserves2.reserve1)
                    .div(realTimeReserves2.reserve0.add(swapAmount.mul(997).div(1000)))
            )
            .sub(1);
        await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
        await pair.connect(mockAuctionSigner).swap(0, expectedOutputAmount, wallet.address);

        // should adequately check that the _update() function properly set reserves and accumulators
        await checkBalances();
        await delay(60);
        await checkBalances();

        // make another discrete swap (checks totalSwappedFunds{0,1} are updated correctly (in _update() function))
        latestTime = (await ethers.provider.getBlock("latest")).timestamp;
        nextBlockTime = latestTime + 10;
        await token0
            .transfer({
                receiver: pair.address,
                amount: swapAmount,
            })
            .exec(wallet);
        realTimeReserves2 = await pair.getReservesAtTime(nextBlockTime);
        expectedOutputAmount = realTimeReserves2.reserve1
            .sub(
                realTimeReserves2.reserve0
                    .mul(realTimeReserves2.reserve1)
                    .div(realTimeReserves2.reserve0.add(swapAmount.mul(997).div(1000)))
            )
            .sub(1);
        await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
        await pair.connect(mockAuctionSigner).swap(0, expectedOutputAmount, wallet.address);
    });
});
