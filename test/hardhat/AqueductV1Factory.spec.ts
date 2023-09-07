import { expect } from "chai";
import { constants as ethconst, utils } from "ethers";
import { AqueductV1Factory } from "../../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { getCreate2Address } from "./shared/utilities";
import { ethers } from "hardhat";

import { Framework } from "@superfluid-finance/sdk-core";
import { deployTestFramework } from "@superfluid-finance/ethereum-contracts/dev-scripts/deploy-test-framework";

let sfDeployer;
let contractsFramework: any;
let sf: Framework;

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
});

describe("AqueductV1Factory", () => {
    async function fixture() {
        const tmp = await ethers.getContractFactory("AqueductV1Factory");
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

    async function createPair(factory: AqueductV1Factory, tokens: [string, string]) {
        const pairContract = await ethers.getContractFactory("AqueductV1Pair");
        const create2Address = getCreate2Address(factory.address, tokens, pairContract.bytecode);
        await expect(factory.createPair(tokens[0], tokens[1]))
            .to.emit(factory, "PairCreated")
            .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], create2Address, 1);

        await expect(factory.createPair(tokens[0], tokens[1])).to.be.reverted; // AqueductV1: PAIR_EXISTS
        await expect(factory.createPair(tokens[1], tokens[0])).to.be.reverted; // AqueductV1: PAIR_EXISTS
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
        expect(codehash).to.be.eq("0x3a149fcc8ae6e3b8ef50e8492426c398bc80e49b2a85aa5f26d36914862b4b3d");
    });

    it("createPair", async () => {
        const { factory } = await loadFixture(fixture);
        await createPair(factory, [...TEST_ADDRESSES]);
    });

    it("createPair:reverse", async () => {
        const { factory } = await loadFixture(fixture);
        await createPair(factory, TEST_ADDRESSES.slice().reverse() as [string, string]);
    });

    it("setFeeTo", async () => {
        const { factory, wallet, other } = await loadFixture(fixture);
        await expect(factory.connect(other).setFeeTo(other.address)).to.be.revertedWithCustomError(
            factory,
            "FACTORY_FORBIDDEN"
        );
        await expect(factory.setFeeTo(wallet.address)).to.emit(factory, "SetFeeTo").withArgs(wallet.address);
        expect(await factory.feeTo()).to.eq(wallet.address);
    });

    it("setFeeToSetter", async () => {
        const { factory, wallet, other } = await loadFixture(fixture);
        await expect(factory.connect(other).setFeeToSetter(other.address)).to.be.revertedWithCustomError(
            factory,
            "FACTORY_FORBIDDEN"
        );
        await expect(factory.setFeeToSetter(other.address)).to.emit(factory, "SetFeeToSetter").withArgs(other.address);
        expect(await factory.feeToSetter()).to.eq(other.address);
        await expect(factory.setFeeToSetter(wallet.address)).to.be.revertedWithCustomError(
            factory,
            "FACTORY_FORBIDDEN"
        );
    });
});
