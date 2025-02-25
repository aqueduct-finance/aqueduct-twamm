import { expect } from "chai";
import { BigNumber, constants as ethconst, Contract } from "ethers";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { expandTo18Decimals, encodePrice } from "./shared/utilities";
import { AqueductV1Pair } from "../../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

/*
    NOTE - using modified version of superfluid for testing
    We make cfa._updateAccountFlowState() public so that we can test arbitrary netFlowRate easily
*/
import { Framework } from "@superfluid-finance/sdk-core";
import { deployTestFramework } from "../../src/test/superfluid-testbench/ethereum-contracts/dev-scripts/deploy-test-framework";
import TestToken from "../../src/test/superfluid-testbench/ethereum-contracts/build/contracts/TestToken.json";
import updateAccountFlowStateAbi from "../../src/test/superfluid-testbench/updateAccountFlowStateAbi.json";

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

    // deploy super tokens
    const mintLimit = ethers.constants.MaxInt256.toString();
    await sfDeployer.frameworkDeployer.deployWrapperSuperToken("Base Token A", "baseTokenA", 18, mintLimit);
    await sfDeployer.frameworkDeployer.deployWrapperSuperToken("Base Token B", "baseTokenB", 18, mintLimit);

    tokenA = await sf.loadSuperToken("baseTokenAx");
    baseTokenA = new ethers.Contract(tokenA.underlyingToken!.address, TestToken.abi, owner);

    tokenB = await sf.loadSuperToken("baseTokenBx");
    baseTokenB = new ethers.Contract(tokenB.underlyingToken!.address, TestToken.abi, owner);

    // gives supertokens to an account
    const setupToken = async (underlyingToken: Contract, superToken: any, signer: any, amount: string) => {
        // minting test token
        await underlyingToken.mint(signer.address, amount);

        // approving DAIx to spend DAI (Super Token object is not an ethers contract object and has different operation syntax)
        await underlyingToken.connect(signer).approve(superToken.address, ethers.constants.MaxInt256);

        // Upgrading all DAI to DAIx
        const ownerUpgrade = superToken.upgrade({
            amount: amount,
        });
        await ownerUpgrade.exec(signer);
    };

    await setupToken(baseTokenA, tokenA, owner, ethers.utils.parseEther("10000").toString());
    await setupToken(baseTokenB, tokenB, owner, ethers.utils.parseEther("10000").toString());
});

const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3);

describe("AqueductV1Pair", () => {
    // uses TestFactory/AccumulatorOverride contracts to allow manually setting accumulators
    async function fixture() {
        const [wallet, other] = await ethers.getSigners();

        const factory = await (
            await ethers.getContractFactory("TestFactory")
        ).deploy(wallet.address, contractsFramework.host);

        await factory.createPair(tokenA.address, tokenB.address);
        const pair = (await ethers.getContractFactory("AccumulatorOverride")).attach(
            await factory.getPair(tokenA.address, tokenB.address)
        );
        const token0Address = await pair.token0();
        const token0 = tokenA.address === token0Address ? tokenA : tokenB;
        const token1 = tokenA.address === token0Address ? tokenB : tokenA;

        // deploy auction and assign to factory
        const auctionFactory = await ethers.getContractFactory("AqueductV1Auction");
        const deployedAuction = await auctionFactory.deploy(factory.address);
        await factory.setAuction(deployedAuction.address);

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
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer")
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
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
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer")
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
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
            .withArgs(pair.address, wallet.address, expectedToken0Amount.sub(1001)) // off by 1 wei, this is ok
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer")
            .withArgs(pair.address, wallet.address, expectedToken1Amount.sub(1000))
            .to.emit(pair, "Sync")
            .withArgs(1001, 1000)
            .to.emit(pair, "Burn")
            .withArgs(wallet.address, expectedToken0Amount.sub(1001), expectedToken1Amount.sub(1000), wallet.address);

        expect(await pair.balanceOf(wallet.address)).to.eq(0);
        expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY);
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

        // cancel stream
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

        // check that stored balance is still correct
        const newExpectedAmountsOut = await pair.getRealTimeUserBalances(wallet.address);
        expect(newExpectedAmountsOut.balance1).to.be.equal(expectedAmountsOut.balance1);

        // retrieve funds and check that swapped balance is withdrawn
        await pair.retrieveFunds(token1.address);
        expect(
            BigNumber.from(
                await token1.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            )
        ).to.be.equal(baseToken1Balance.add(expectedAmountsOut.balance1));

        // check that balances are now 0
        const newExpectedAmountsOut2 = await pair.getRealTimeUserBalances(wallet.address);
        expect(newExpectedAmountsOut2.balance1).to.be.equal(BigNumber.from(0));
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

        // cancel stream
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

        // check that stored balance is still correct
        const newExpectedAmountsOut = await pair.getRealTimeUserBalances(wallet.address);
        expect(newExpectedAmountsOut.balance0).to.be.equal(expectedAmountsOut.balance0);

        // retrieve funds and check that swapped balance is withdrawn
        await pair.retrieveFunds(token0.address);
        expect(
            BigNumber.from(
                await token0.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            )
        ).to.be.equal(baseToken0Balance.add(expectedAmountsOut.balance0));

        // check that balances are now 0
        const newExpectedAmountsOut2 = await pair.getRealTimeUserBalances(wallet.address);
        expect(newExpectedAmountsOut2.balance0).to.be.equal(BigNumber.from(0));
    });

    /*
        NOTE: 
        accumulator overflow is basically impossible:
        1. accumulators are UQ160x96 == 160 bit resolution (2^160 - 1)
        2. netFlowRate is int96, so max netFlowRate is 2^95 - 1
        3. find number of seconds required to overflow an accumulator:
            (2^160 -1) / (2^95 -1) == 3.689e19 seconds == ~1.16 trillion years

        tl;dr there is no way to natively test accumulator overflow without overflowing time many times
        - if (time - timeStart > max uint32), balance tracking will work as long as the pool has any interaction during that period
        - this is presumed to be acceptable because it takes around ~136 years for 'time' to cycle

        thus we have four related tests:
        1. twap:max_flowrates - tests accurate balance tracking for edge case of max flowrate of both tokens
        2/3. twap:accumulator_overflow{0,1} - use AccumulatorOverride.sol to inherit AqueductV1Pair and manually set accumulators
        4. twap:overflow_time - test single overflow of time, where the position's (time - timeStart < max uint32)
    */
    it("twap:max_flowrates", async () => {
        const { pair, wallet, token0, token1 } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(10);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const nextTime = (await ethers.provider.getBlock("latest")).timestamp + 1000;

        // Disable automining, so that these transactions are in the same block, and manually set the time
        await ethers.provider.send("evm_setNextBlockTimestamp", [nextTime]);
        await network.provider.send("evm_setAutomine", [false]);

        /*
            NOTE: using modified version of superfluid cfa for testing:
            1. create a stream to set blockTimestampLast in the contract
            2. manually change netFlowRate of both tokens to max values
        */

        // create a stream
        const flowRate = "1";
        const createFlowOperation = token0.createFlow({
            sender: wallet.address,
            receiver: pair.address,
            flowRate: flowRate,
        });
        await createFlowOperation.exec(wallet);

        // set net flow rates
        const fakeNetFlowRate = BigNumber.from(2).pow(95).sub(2); // max int96 - 1
        const cfaContract = new ethers.Contract(contractsFramework.cfa, updateAccountFlowStateAbi, wallet);
        await cfaContract._updateAccountFlowState(
            token0.address,
            pair.address,
            fakeNetFlowRate,
            0,
            0,
            nextTime.toString()
        );
        await cfaContract._updateAccountFlowState(
            token1.address,
            pair.address,
            fakeNetFlowRate,
            0,
            0,
            nextTime.toString()
        );

        // mine block
        await network.provider.send("evm_setAutomine", [true]);
        await network.provider.send("evm_mine");

        // check net flows
        const netFlow0 = await token0.getNetFlow({
            account: pair.address,
            providerOrSigner: wallet,
        });
        const netFlow1 = await token1.getNetFlow({
            account: pair.address,
            providerOrSigner: wallet,
        });
        expect(netFlow0).to.eq(fakeNetFlowRate.add(1));
        expect(netFlow1).to.eq(fakeNetFlowRate);

        // check balance
        const checkBalance = async () => {
            const realTimeReserves = await pair.getReserves();
            const walletSwapBalances = await pair.getRealTimeUserBalances(wallet.address);
            const timeDiff = parseInt(walletSwapBalances.time.toString()) - nextTime;
            const accumulator =
                (parseInt(netFlow1) * timeDiff +
                    parseInt(token1Amount.toString()) -
                    parseInt(realTimeReserves.reserve1.toString())) /
                netFlow0;
            const expectedBalance = parseInt(flowRate) * accumulator;

            // perfect case:          actual balance = expected balance
            // never allowed:         actual balance > expected balance
            // dust amounts allowed:  actual balance < expected balance
            expect(parseInt(walletSwapBalances.balance1.toString()) - expectedBalance).to.be.within(-1000, 0); // within 1000 wei
        };

        await checkBalance();
        delay(60000);
        await checkBalance();
    });

    it("twap:accumulator_overflow0", async () => {
        const { pair, wallet, token0, token1 } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(10);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair as AqueductV1Pair, wallet, token0Amount, token1Amount);

        // manually set twap0CumulativeLast very close to max uint256
        const flowRate = BigNumber.from("1000000000");
        const newCumulative = ethers.constants.MaxUint256.sub(flowRate);
        pair.setTwap0CumulativeLast(newCumulative); // difference is same as flowRate, so should overflow almost immediately
        expect(await pair.twap0CumulativeLast()).to.be.eq(newCumulative);

        // create a stream (need to stream token1 to update twap0CumulativeLast)
        const createFlowOperation = token1.createFlow({
            sender: wallet.address,
            receiver: pair.address,
            flowRate: flowRate,
        });
        const txnResponse = await createFlowOperation.exec(wallet);
        await txnResponse.wait();

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

        // small delay
        await delay(100);

        // check balances
        await checkBalances();

        // twap0CumulativeLast should be less than its starting value (indicates overflow happened)
        await pair.sync(); // call sync to update accumulators
        expect(await pair.twap0CumulativeLast()).to.be.lt(newCumulative);

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
        await pair.retrieveFunds(token0.address);
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

    it("twap:accumulator_overflow1", async () => {
        const { pair, wallet, token0, token1 } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(10);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair as AqueductV1Pair, wallet, token0Amount, token1Amount);

        // manually set twap0CumulativeLast very close to max uint256
        const flowRate = BigNumber.from("1000000000");
        const newCumulative = ethers.constants.MaxUint256.sub(flowRate);
        pair.setTwap1CumulativeLast(newCumulative); // difference is same as flowRate, so should overflow almost immediately
        expect(await pair.twap1CumulativeLast()).to.be.eq(newCumulative);

        // create a stream (need to stream token0 to update twap1CumulativeLast)
        const createFlowOperation = token0.createFlow({
            sender: wallet.address,
            receiver: pair.address,
            flowRate: flowRate,
        });
        const txnResponse = await createFlowOperation.exec(wallet);
        await txnResponse.wait();

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

        // small delay
        await delay(100);

        // check balances
        await checkBalances();

        // twap1CumulativeLast should be less than its starting value (indicates overflow happened)
        await pair.sync(); // call sync to update accumulators
        expect(await pair.twap1CumulativeLast()).to.be.lt(newCumulative);

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
        await pair.retrieveFunds(token1.address);
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
    });

    it("twap:overflow_time", async () => {
        const { pair, wallet, token0, token1 } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(10);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        // create a stream
        const flowRate = "1000000000"; // small flowrate so that token0 reserve doesn't overflow
        const createFlowOperation = token0.createFlow({
            sender: wallet.address,
            receiver: pair.address,
            flowRate: flowRate,
        });
        const txnResponse = await createFlowOperation.exec(wallet);
        const txn = await txnResponse.wait();
        const timeStart = (await ethers.provider.getBlock(txn.blockNumber)).timestamp;

        const checkBalances = async (expectTimeOverflow: boolean) => {
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

            // if time overflows, 'time' should be less than the timestamp of the first transaction
            if (expectTimeOverflow) {
                expect(realTimeReserves.time).to.be.lessThan(timeStart);
            } else {
                expect(realTimeReserves.time).to.be.greaterThanOrEqual(timeStart);
            }
        };

        // standard balance checks
        await checkBalances(false);
        await delay(1000);
        await checkBalances(false);

        // overflow time
        const maxUint32 = BigNumber.from(2).pow(32).sub(1);
        const timeDiff = maxUint32.sub(timeStart);
        await delay(parseInt(timeDiff.toString())); // this will definitely overflow because we've already delayed 1000s
        await checkBalances(true); // expect time overflow

        // allow time to do a full cycle and exceed the initial timestamp
        await pair.sync(); // pool interaction before time delay, need this to update accumulators correctly
        await delay(timeStart);
        await checkBalances(false); // time will be > timeStart
    });

    it("twap:retrieve_funds_token0", async () => {
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
        await txnResponse.wait();

        // skip ahead
        await delay(600);

        // check that correct swapped balance is withdrawn
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

        // retrieve funds
        await expect(pair.retrieveFunds(token1.address))
            .to.emit(pair, "RetrieveFunds")
            .withArgs(token1.address, wallet.address, expectedAmountsOut.balance1);

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
    });

    it("twap:retrieve_funds_token1", async () => {
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
        await txnResponse.wait();

        // skip ahead
        await delay(600);

        // check that correct swapped balance is withdrawn
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

        // retrieve funds
        await expect(pair.retrieveFunds(token0.address))
            .to.emit(pair, "RetrieveFunds")
            .withArgs(token0.address, wallet.address, expectedAmountsOut.balance0);

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
        //    a = B * (A + (r_A * dt)) / (B + (r_B * dt))       //
        //                                                      //
        //////////////////////////////////////////////////////////
        const checkDynamicReservesParadigmApprox = async (dt: number) => {
            const realTimeReserves = await pair.getReserves();
            const poolReserveA = parseFloat(token0Amount.toString());
            const poolReserveB = parseFloat(token1Amount.toString());
            const totalFlowA = (parseFloat(flowRate0.toString()) * (10000 - UPPER_FEE)) / 10000; // upper fee should be taken from input amounts
            const totalFlowB = (parseFloat(flowRate1.toString()) * (10000 - UPPER_FEE)) / 10000;
            const k = poolReserveA * poolReserveB;

            const a = (poolReserveB * (poolReserveA + totalFlowA * dt)) / (poolReserveB + totalFlowB * dt);
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

        // cancel stream and check that swapped balances are withdrawn
        latestTime = (await ethers.provider.getBlock("latest")).timestamp;
        nextBlockTime = latestTime + 10;
        const token0BalanceInfo = await token0.realtimeBalanceOf({
            account: wallet.address,
            timestamp: nextBlockTime,
            providerOrSigner: ethers.provider,
        });
        const token1BalanceInfo = await token1.realtimeBalanceOf({
            account: wallet.address,
            timestamp: nextBlockTime,
            providerOrSigner: ethers.provider,
        });
        const baseToken0Balance = BigNumber.from(token0BalanceInfo.availableBalance).add(token0BalanceInfo.deposit);
        const baseToken1Balance = BigNumber.from(token1BalanceInfo.availableBalance).add(token1BalanceInfo.deposit);
        const expectedAmountsOut = await pair.getUserBalancesAtTime(wallet.address, nextBlockTime);
        await ethers.provider.send("evm_setNextBlockTimestamp", [nextBlockTime]);
        await network.provider.send("evm_setAutomine", [false]);
        const deleteFlowOperation0 = token0.deleteFlow({
            sender: wallet.address,
            receiver: pair.address,
        });
        const deleteFlowOperation1 = token1.deleteFlow({
            sender: wallet.address,
            receiver: pair.address,
        });
        await deleteFlowOperation0.exec(wallet);
        await deleteFlowOperation1.exec(wallet);

        // mine block
        await network.provider.send("evm_setAutomine", [true]);
        await network.provider.send("evm_mine");

        // retrieve funds
        await pair.retrieveFunds(token0.address);
        await pair.retrieveFunds(token1.address);

        expect(
            BigNumber.from(
                await token0.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            )
        ).to.be.equal(baseToken0Balance.add(expectedAmountsOut.balance0));
        expect(
            BigNumber.from(
                await token1.balanceOf({
                    account: wallet.address,
                    providerOrSigner: ethers.provider,
                })
            )
        ).to.be.equal(baseToken1Balance.add(expectedAmountsOut.balance1));

        // check that total locked swapped amounts are 0
        const lockedSwapAmounts = await pair.getRealTimeUserBalances(wallet.address);
        expect(lockedSwapAmounts.balance0).to.eq(BigNumber.from(0));
        expect(lockedSwapAmounts.balance1).to.eq(BigNumber.from(0));
    });
});
