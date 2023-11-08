import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expandTo18Decimals, MINIMUM_LIQUIDITY, AqueductVersion } from "./shared/utilities";
import { AqueductV1Pair } from "../../typechain-types";

import { Framework } from "@superfluid-finance/sdk-core";
import { deployTestFramework } from "@superfluid-finance/ethereum-contracts/dev-scripts/deploy-test-framework";
import TestToken from "@superfluid-finance/ethereum-contracts/build/contracts/TestToken.json";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

let sfDeployer;
let contractsFramework: any;
let sf: Framework;
let baseTokenA;
let baseTokenB;
let tokenA: any;
let tokenB: any;

// Test Accounts
let owner: SignerWithAddress;

// delay helper function
const delay = async (seconds: number) => {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
};

// erc20 abi, used to correctly check for Transfer event
const erc20Abi = ["event Transfer(address indexed from, address indexed to, uint256 value)"];

before(async function () {
    // get hardhat accounts
    [owner] = await ethers.getSigners();

    // GETTING SUPERFLUID FRAMEWORK SET UP

    // deploy the framework locally
    sfDeployer = await deployTestFramework();
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

describe("AqueductV1Router", () => {
    async function v2Fixture() {
        const [wallet] = await ethers.getSigners();

        const weth = await ethers.getContractFactory("WETH9");
        const WETH = await weth.deploy();

        const erc20 = await ethers.getContractFactory("src/test/ERC20.sol:ERC20");
        const WETHPartner = await erc20.deploy(expandTo18Decimals(10000));

        // deploy V2
        const v2factory = await ethers.getContractFactory("AqueductV1Factory");
        const factoryV2 = await v2factory.deploy(wallet.address, contractsFramework.host);

        const routerEmit = await ethers.getContractFactory("RouterEventEmitter");

        const RouterEmit = await routerEmit.deploy();

        // deploy routers
        const router = await ethers.getContractFactory("AqueductV1Router");
        const router02 = await router.deploy(factoryV2.address);
        await factoryV2.setAuction(router02.address); // allows router to call the swap() function

        // initialize V2
        await factoryV2.createPair(tokenA.address, tokenB.address);
        const pairAddress = await factoryV2.getPair(tokenA.address, tokenB.address);
        const pairFactory = await ethers.getContractFactory("AqueductV1Pair");
        const pair = new Contract(pairAddress, pairFactory.interface, wallet) as AqueductV1Pair;

        const token0Address = await pair.token0();
        const token0 = tokenA.address === token0Address ? tokenA : tokenB;
        const token1 = tokenA.address === token0Address ? tokenB : tokenA;

        await factoryV2.createPair(WETH.address, WETHPartner.address);
        const WETHPairAddress = await factoryV2.getPair(WETH.address, WETHPartner.address);

        const wethPair = new Contract(WETHPairAddress, pairFactory.interface, wallet);

        return {
            token0,
            token1,
            WETH,
            WETHPartner,
            factoryV2,
            router02,
            pair,
            RouterEmit,
            wallet,
            wethPair,
        };
    }

    it("quote", async () => {
        const { router02: router } = await loadFixture(v2Fixture);
        expect(await router.quote(BigNumber.from(1), BigNumber.from(100), BigNumber.from(200))).to.eq(
            BigNumber.from(2)
        );
        expect(await router.quote(BigNumber.from(2), BigNumber.from(200), BigNumber.from(100))).to.eq(
            BigNumber.from(1)
        );
        await expect(
            router.quote(BigNumber.from(0), BigNumber.from(100), BigNumber.from(200))
        ).to.be.revertedWithCustomError(router, "LIBRARY_INSUFFICIENT_AMOUNT");
        await expect(
            router.quote(BigNumber.from(1), BigNumber.from(0), BigNumber.from(200))
        ).to.be.revertedWithCustomError(router, "LIBRARY_INSUFFICIENT_LIQUIDITY");
        await expect(
            router.quote(BigNumber.from(1), BigNumber.from(100), BigNumber.from(0))
        ).to.be.revertedWithCustomError(router, "LIBRARY_INSUFFICIENT_LIQUIDITY");
    });

    it("getAmountOut", async () => {
        const { router02: router } = await loadFixture(v2Fixture);

        expect(await router.getAmountOut(BigNumber.from(2), BigNumber.from(100), BigNumber.from(100))).to.eq(
            BigNumber.from(1)
        );
        await expect(
            router.getAmountOut(BigNumber.from(0), BigNumber.from(100), BigNumber.from(100))
        ).to.be.revertedWithCustomError(router, "LIBRARY_INSUFFICIENT_INPUT_AMOUNT");
        await expect(
            router.getAmountOut(BigNumber.from(2), BigNumber.from(0), BigNumber.from(100))
        ).to.be.revertedWithCustomError(router, "LIBRARY_INSUFFICIENT_LIQUIDITY");
        await expect(
            router.getAmountOut(BigNumber.from(2), BigNumber.from(100), BigNumber.from(0))
        ).to.be.revertedWithCustomError(router, "LIBRARY_INSUFFICIENT_LIQUIDITY");
    });

    it("getAmountIn", async () => {
        const { router02: router } = await loadFixture(v2Fixture);

        expect(await router.getAmountIn(BigNumber.from(1), BigNumber.from(100), BigNumber.from(100))).to.eq(
            BigNumber.from(2)
        );
        await expect(
            router.getAmountIn(BigNumber.from(0), BigNumber.from(100), BigNumber.from(100))
        ).to.be.revertedWithCustomError(router, "LIBRARY_INSUFFICIENT_OUTPUT_AMOUNT");
        await expect(
            router.getAmountIn(BigNumber.from(1), BigNumber.from(0), BigNumber.from(100))
        ).to.be.revertedWithCustomError(router, "LIBRARY_INSUFFICIENT_LIQUIDITY");
        await expect(
            router.getAmountIn(BigNumber.from(1), BigNumber.from(100), BigNumber.from(0))
        ).to.be.revertedWithCustomError(router, "LIBRARY_INSUFFICIENT_LIQUIDITY");
    });

    it("getAmountsOut", async () => {
        const { router02: router, token0, token1, wallet } = await loadFixture(v2Fixture);

        await token0.approve({ receiver: router.address, amount: ethers.constants.MaxUint256 }).exec(wallet);
        await token1.approve({ receiver: router.address, amount: ethers.constants.MaxUint256 }).exec(wallet);
        await router.addLiquidity(
            token0.address,
            token1.address,
            BigNumber.from(10000),
            BigNumber.from(10000),
            0,
            0,
            wallet.address,
            ethers.constants.MaxUint256
        );

        await expect(router.getAmountsOut(BigNumber.from(2), [token0.address])).to.be.revertedWithCustomError(
            router,
            "LIBRARY_INVALID_PATH"
        );
        const path = [token0.address, token1.address];
        expect(await router.getAmountsOut(BigNumber.from(2), path)).to.deep.eq([BigNumber.from(2), BigNumber.from(1)]);
    });

    it("getAmountsIn", async () => {
        const { router02: router, token0, token1, wallet } = await loadFixture(v2Fixture);

        await token0.approve({ receiver: router.address, amount: ethers.constants.MaxUint256 }).exec(wallet);
        await token1.approve({ receiver: router.address, amount: ethers.constants.MaxUint256 }).exec(wallet);
        await router.addLiquidity(
            token0.address,
            token1.address,
            BigNumber.from(10000),
            BigNumber.from(10000),
            0,
            0,
            wallet.address,
            ethers.constants.MaxUint256
        );

        await expect(router.getAmountsIn(BigNumber.from(1), [token0.address])).to.be.revertedWithCustomError(
            router,
            "LIBRARY_INVALID_PATH"
        );
        const path = [token0.address, token1.address];
        expect(await router.getAmountsIn(BigNumber.from(1), path)).to.deep.eq([BigNumber.from(2), BigNumber.from(1)]);
    });

    it("addLiquidity", async () => {
        const { router02, token0, token1, wallet, pair } = await loadFixture(v2Fixture);

        const token0Amount = expandTo18Decimals(1);
        const token1Amount = expandTo18Decimals(4);

        const expectedLiquidity = expandTo18Decimals(2);
        await token0.approve({ receiver: router02.address, amount: ethers.constants.MaxUint256 }).exec(wallet);
        await token1.approve({ receiver: router02.address, amount: ethers.constants.MaxUint256 }).exec(wallet);
        await expect(
            router02.addLiquidity(
                token0.address,
                token1.address,
                token0Amount,
                token1Amount,
                0,
                0,
                wallet.address,
                ethers.constants.MaxUint256
            )
        )
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer")
            .withArgs(wallet.address, pair.address, token0Amount)
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer")
            .withArgs(wallet.address, pair.address, token1Amount)
            .to.emit(pair, "Transfer")
            .withArgs(ethers.constants.AddressZero, ethers.constants.AddressZero, MINIMUM_LIQUIDITY)
            .to.emit(pair, "Transfer")
            .withArgs(ethers.constants.AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
            .to.emit(pair, "Sync")
            .withArgs(token0Amount, token1Amount)
            .to.emit(pair, "Mint")
            .withArgs(router02.address, token0Amount, token1Amount);

        expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY));
    });

    it("removeLiquidity", async () => {
        const { router02, token0, token1, wallet, pair } = await loadFixture(v2Fixture);

        const token0Amount = expandTo18Decimals(1);
        const token1Amount = expandTo18Decimals(4);
        await token0.transfer({ receiver: pair.address, amount: token0Amount }).exec(wallet);
        await token1.transfer({ receiver: pair.address, amount: token1Amount }).exec(wallet);
        await pair.mint(wallet.address);

        const expectedLiquidity = expandTo18Decimals(2);
        await pair.approve(router02.address, ethers.constants.MaxUint256);
        await expect(
            router02.removeLiquidity(
                token0.address,
                token1.address,
                expectedLiquidity.sub(MINIMUM_LIQUIDITY),
                0,
                0,
                wallet.address,
                ethers.constants.MaxUint256
            )
        )
            .to.emit(pair, "Transfer")
            .withArgs(wallet.address, pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
            .to.emit(pair, "Transfer")
            .withArgs(pair.address, ethers.constants.AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer")
            .withArgs(pair.address, wallet.address, token0Amount.sub(500))
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer")
            .withArgs(pair.address, wallet.address, token1Amount.sub(2000))
            .to.emit(pair, "Sync")
            .withArgs(500, 2000)
            .to.emit(pair, "Burn")
            .withArgs(router02.address, token0Amount.sub(500), token1Amount.sub(2000), wallet.address);

        expect(await pair.balanceOf(wallet.address)).to.eq(0);
        const totalSupplyToken0 = BigNumber.from(await token0.totalSupply({ providerOrSigner: ethers.provider }));
        const totalSupplyToken1 = BigNumber.from(await token1.totalSupply({ providerOrSigner: ethers.provider }));
        expect(await token0.balanceOf({ account: wallet.address, providerOrSigner: ethers.provider })).to.eq(
            totalSupplyToken0.sub(500)
        );
        expect(await token1.balanceOf({ account: wallet.address, providerOrSigner: ethers.provider })).to.eq(
            totalSupplyToken1.sub(2000)
        );
    });

    it("removeLiquidityWithPermit", async () => {
        const { router02, token0, token1, wallet, pair } = await loadFixture(v2Fixture);

        const token0Amount = expandTo18Decimals(1);
        const token1Amount = expandTo18Decimals(4);
        await token0.transfer({ receiver: pair.address, amount: token0Amount }).exec(wallet);
        await token1.transfer({ receiver: pair.address, amount: token1Amount }).exec(wallet);
        await pair.mint(wallet.address);

        const expectedLiquidity = expandTo18Decimals(2);

        const nonce = await pair.nonces(wallet.address);
        const tokenName = await pair.name();
        const chainId = await wallet.getChainId();
        const sig = await wallet._signTypedData(
            // "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
            {
                name: tokenName,
                version: AqueductVersion,
                chainId: chainId,
                verifyingContract: pair.address,
            },
            // "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
            {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                ],
            },
            {
                owner: wallet.address,
                spender: router02.address,
                value: expectedLiquidity.sub(MINIMUM_LIQUIDITY),
                nonce: nonce,
                deadline: ethers.constants.MaxUint256,
            }
        );

        const { r, s, v } = ethers.utils.splitSignature(sig);

        await router02.removeLiquidityWithPermit(
            token0.address,
            token1.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            ethers.constants.MaxUint256,
            false,
            v,
            r,
            s
        );
    });

    describe("swapExactTokensForTokens", () => {
        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        const swapAmount = expandTo18Decimals(1);
        const expectedOutputAmount = BigNumber.from("1662497915624478906");

        it("happy path", async () => {
            const { router02, token0, token1, wallet, pair } = await loadFixture(v2Fixture);

            // before each
            await token0.transfer({ receiver: pair.address, amount: token0Amount }).exec(wallet);
            await token1.transfer({ receiver: pair.address, amount: token1Amount }).exec(wallet);
            await pair.mint(wallet.address);

            await token0.approve({ receiver: router02.address, amount: ethers.constants.MaxUint256 }).exec(wallet);

            await expect(
                router02.swapExactTokensForTokens(
                    swapAmount,
                    0,
                    [token0.address, token1.address],
                    wallet.address,
                    ethers.constants.MaxUint256
                )
            )
                .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer")
                .withArgs(wallet.address, pair.address, swapAmount)
                .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer")
                .withArgs(pair.address, wallet.address, expectedOutputAmount)
                .to.emit(pair, "Sync")
                .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
                .to.emit(pair, "Swap")
                .withArgs(router02.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address);
        });

        it("amounts", async () => {
            const { router02, token0, token1, wallet, pair, RouterEmit, factoryV2 } = await loadFixture(v2Fixture);

            // need to allow RouterEmit to call swap() (it's using router02.delegateCall())
            await factoryV2.setAuction(RouterEmit.address);

            // before each
            await token0.transfer({ receiver: pair.address, amount: token0Amount }).exec(wallet);
            await token1.transfer({ receiver: pair.address, amount: token1Amount }).exec(wallet);
            await pair.mint(wallet.address);
            await token0.approve({ receiver: router02.address, amount: ethers.constants.MaxUint256 }).exec(wallet);

            await token0.approve({ receiver: RouterEmit.address, amount: ethers.constants.MaxUint256 }).exec(wallet);
            await expect(
                RouterEmit.swapExactTokensForTokens(
                    router02.address,
                    swapAmount,
                    0,
                    [token0.address, token1.address],
                    wallet.address,
                    ethers.constants.MaxUint256
                )
            )
                .to.emit(RouterEmit, "Amounts")
                .withArgs([swapAmount, expectedOutputAmount]);
        });

        it("gas", async () => {
            const { router02, token0, token1, wallet, pair } = await loadFixture(v2Fixture);

            // before each
            await token0.transfer({ receiver: pair.address, amount: token0Amount }).exec(wallet);
            await token1.transfer({ receiver: pair.address, amount: token1Amount }).exec(wallet);
            await pair.mint(wallet.address);
            await token0.approve({ receiver: router02.address, amount: ethers.constants.MaxUint256 }).exec(wallet);

            // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
            await time.setNextBlockTimestamp((await ethers.provider.getBlock("latest")).timestamp + 1);
            await pair.sync();

            await token0.approve({ receiver: router02.address, amount: ethers.constants.MaxUint256 }).exec(wallet);
            await time.setNextBlockTimestamp((await ethers.provider.getBlock("latest")).timestamp + 1);
            const tx = await router02.swapExactTokensForTokens(
                swapAmount,
                0,
                [token0.address, token1.address],
                wallet.address,
                ethers.constants.MaxUint256
            );
            const receipt = await tx.wait();
            expect(receipt.gasUsed).to.eq(457777, "gas used");
        });
    });

    describe("swapTokensForExactTokens", () => {
        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        const expectedSwapAmount = BigNumber.from("557227237267357629");
        const outputAmount = expandTo18Decimals(1);

        it("happy path", async () => {
            const { router02, token0, token1, wallet, pair } = await loadFixture(v2Fixture);

            // before each
            await token0.transfer({ receiver: pair.address, amount: token0Amount }).exec(wallet);
            await token1.transfer({ receiver: pair.address, amount: token1Amount }).exec(wallet);
            await pair.mint(wallet.address);

            await token0.approve({ receiver: router02.address, amount: ethers.constants.MaxUint256 }).exec(wallet);
            await expect(
                router02.swapTokensForExactTokens(
                    outputAmount,
                    ethers.constants.MaxUint256,
                    [token0.address, token1.address],
                    wallet.address,
                    ethers.constants.MaxUint256
                )
            )
                .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer")
                .withArgs(wallet.address, pair.address, expectedSwapAmount)
                .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer")
                .withArgs(pair.address, wallet.address, outputAmount)
                .to.emit(pair, "Sync")
                .withArgs(token0Amount.add(expectedSwapAmount), token1Amount.sub(outputAmount))
                .to.emit(pair, "Swap")
                .withArgs(router02.address, expectedSwapAmount, 0, 0, outputAmount, wallet.address);
        });

        it("amounts", async () => {
            const { router02, token0, token1, wallet, pair, RouterEmit, factoryV2 } = await loadFixture(v2Fixture);

            // need to allow RouterEmit to call swap() (it's using router02.delegateCall())
            await factoryV2.setAuction(RouterEmit.address);

            // before each
            await token0.transfer({ receiver: pair.address, amount: token0Amount }).exec(wallet);
            await token1.transfer({ receiver: pair.address, amount: token1Amount }).exec(wallet);
            await pair.mint(wallet.address);

            await token0.approve({ receiver: RouterEmit.address, amount: ethers.constants.MaxUint256 }).exec(wallet);
            await expect(
                RouterEmit.swapTokensForExactTokens(
                    router02.address,
                    outputAmount,
                    ethers.constants.MaxUint256,
                    [token0.address, token1.address],
                    wallet.address,
                    ethers.constants.MaxUint256
                )
            )
                .to.emit(RouterEmit, "Amounts")
                .withArgs([expectedSwapAmount, outputAmount]);
        });
    });
});
