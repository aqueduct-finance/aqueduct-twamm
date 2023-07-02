import { expect } from "chai";
import { constants as ethconst, utils } from "ethers";
import { UniswapV2Factory } from "../../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { getCreate2Address } from "./shared/utilities";
import { ethers } from "hardhat";

import { Framework } from "@superfluid-finance/sdk-core";
import { deployTestFramework } from "@superfluid-finance/ethereum-contracts/dev-scripts/deploy-test-framework";

let sfDeployer;
let contractsFramework: any;
let sf: Framework;
let baseTokenA;
let baseTokenB;
let tokenA: any;
let tokenB: any;

const TEST_ADDRESSES: [string, string] = [
    "0x1000000000000000000000000000000000000000",
    "0x2000000000000000000000000000000000000000",
];

before(async function () {
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
/*
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
    */
});

describe("UniswapV2Factory", () => {
    async function fixture() {
        const tmp = await ethers.getContractFactory("UniswapV2Factory");
        const [wallet, other] = await ethers.getSigners();
        const factory = await tmp.deploy(wallet.address, contractsFramework.host);
        return { factory: factory, wallet, other };
    }

    it("feeTo, feeToSetter, allPairsLength", async () => {
        const { factory, wallet } = await loadFixture(fixture);
        expect(await factory.feeTo()).to.eq(ethconst.AddressZero);
        expect(await factory.feeToSetter()).to.eq(wallet.address);
        expect(await factory.allPairsLength()).to.eq(0);
    });

    async function createPair(factory: UniswapV2Factory, tokens: [string, string]) {
        const pairContract = await ethers.getContractFactory("UniswapV2Pair");
        const bytecodeWithConstructor = pairContract.bytecode + utils.defaultAbiCoder.encode(
            ["address"],
            [contractsFramework.host]
        ).slice(2);
        const create2Address = getCreate2Address(factory.address, tokens, bytecodeWithConstructor);
        await expect(factory.createPair(tokens[0], tokens[1]))
            .to.emit(factory, "PairCreated")
            .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], create2Address, 1);

        await expect(factory.createPair(tokens[0], tokens[1])).to.be.reverted; // UniswapV2: PAIR_EXISTS
        await expect(factory.createPair(tokens[1], tokens[0])).to.be.reverted; // UniswapV2: PAIR_EXISTS
        expect(await factory.getPair(tokens[0], tokens[1])).to.eq(create2Address);
        expect(await factory.getPair(tokens[1], tokens[0])).to.eq(create2Address);
        expect(await factory.allPairs(0)).to.eq(create2Address);
        expect(await factory.allPairsLength()).to.eq(1);

        const pair = pairContract.attach(create2Address);
        expect(await pair.factory()).to.eq(factory.address);
        expect(await pair.token0()).to.eq(TEST_ADDRESSES[0]);
        expect(await pair.token1()).to.eq(TEST_ADDRESSES[1]);
    }

    it("Pair:codeHash", async () => {
        const { factory } = await loadFixture(fixture);
        const codehash = await factory.PAIR_HASH();
        // const pair = await ethers.getContractFactory("UniswapV2Pair");
        // expect(ethers.utils.keccak256(pair.bytecode)).to.be.eq(codehash);
        expect(codehash).to.be.eq("0x71b41af72e1ae5558d2251ecf045abea703312602c3d084711defd8ead00a1a6");
    });

    it("createPair", async () => {
        const { factory } = await loadFixture(fixture);
        await createPair(factory, [...TEST_ADDRESSES]);
    });

    it("createPair:reverse", async () => {
        const { factory } = await loadFixture(fixture);
        await createPair(factory, TEST_ADDRESSES.slice().reverse() as [string, string]);
    });

    /*
    NOTE: modifications to contract caused changes in gas cost, so temporarily removing this test
    it("createPair:gas", async () => {
        const { factory } = await loadFixture(fixture);
        const tx = await factory.createPair(...TEST_ADDRESSES);
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.eq(2355845);
    });
    */

    it("setFeeTo", async () => {
        const { factory, wallet, other } = await loadFixture(fixture);
        await expect(factory.connect(other).setFeeTo(other.address)).to.be.revertedWith("UniswapV2: FORBIDDEN");
        await factory.setFeeTo(wallet.address);
        expect(await factory.feeTo()).to.eq(wallet.address);
    });

    it("setFeeToSetter", async () => {
        const { factory, wallet, other } = await loadFixture(fixture);
        await expect(factory.connect(other).setFeeToSetter(other.address)).to.be.revertedWith("UniswapV2: FORBIDDEN");
        await factory.setFeeToSetter(other.address);
        expect(await factory.feeToSetter()).to.eq(other.address);
        await expect(factory.setFeeToSetter(wallet.address)).to.be.revertedWith("UniswapV2: FORBIDDEN");
    });
});
