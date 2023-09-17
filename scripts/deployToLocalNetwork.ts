/**
 *
 * Deploys the Superfluid framework, test tokens, and the core contract for a pair
 *
 * to run: yarn hardhat run scripts/deployToLocalNetwork.ts --network localhost
 *
 */

import hre, { ethers } from "hardhat";
import { deployTestFramework } from "@superfluid-finance/ethereum-contracts/dev-scripts/deploy-test-framework";
import TestToken from "@superfluid-finance/ethereum-contracts/build/contracts/TestToken.json";
import { Framework } from "@superfluid-finance/sdk-core";

const main = async () => {
    const tenThousandEther = ethers.utils.parseEther("10000");
    const oneThousandEther = ethers.utils.parseEther("1000");
    const tenEther = "10000000000000000000";

    const accounts = await hre.ethers.getSigners();
    const account = accounts[0];

    // init and deploy Superfluid framework
    const sfDeployer = await deployTestFramework();
    const contractsFramework = await sfDeployer.frameworkDeployer.getFramework();
    const sf = await Framework.create({
        chainId: 31337,
        provider: account.provider!,
        resolverAddress: contractsFramework.resolver,
        protocolReleaseVersion: "test",
    });

    const superfluidHost = sf.host.contract.address;
    const cfav1 = sf.cfaV1.contract.address;

    // deploy tokens
    await sfDeployer.frameworkDeployer.deployWrapperSuperToken(
        "Fake DAI Token",
        "DAI",
        18,
        ethers.utils.parseEther("100000000").toString()
    );

    await sfDeployer.frameworkDeployer.deployWrapperSuperToken(
        "Fake USDC Token",
        "USDC",
        18,
        ethers.utils.parseEther("100000000").toString()
    );

    const DAIx = await sf.loadSuperToken("DAIx");
    const USDCx = await sf.loadSuperToken("USDCx");
    const DAI = new ethers.Contract(DAIx.underlyingToken!.address, TestToken.abi, account);
    const USDC = new ethers.Contract(USDCx.underlyingToken!.address, TestToken.abi, account);

    // mint ERC20 tokens
    await DAI.mint(account.address, tenThousandEther);
    await USDC.mint(account.address, tenThousandEther);

    // upgrade to SuperTokens
    await DAI.approve(DAIx.address, ethers.constants.MaxInt256);
    const daiUpgarde = await DAIx.upgrade({ amount: oneThousandEther });
    await daiUpgarde.exec(account);

    await USDC.approve(USDCx.address, ethers.constants.MaxInt256);
    const usdcUpgarde = await USDCx.upgrade({ amount: oneThousandEther });
    await usdcUpgarde.exec(account);

    const DAIAddress = DAI.address;
    const USDCAddress = USDC.address;
    const DAIxAddress = DAIx.address;
    const USDCxAddress = USDCx.address;

    // deploy factory
    const Factory = await hre.ethers.getContractFactory("AqueductV1Factory");
    const factory = await Factory.deploy(account.address, superfluidHost);

    // deploy pool
    await factory.createPair(DAIxAddress, USDCxAddress);
    const pool = (await hre.ethers.getContractFactory("AqueductV1Pair")).attach(
        await factory.getPair(DAIxAddress, USDCxAddress)
    );

    // LP
    await DAIx.transfer({
        receiver: pool.address,
        amount: tenEther,
        overrides: { gasLimit: 200000 },
    }).exec(account);

    await USDCx.transfer({
        receiver: pool.address,
        amount: tenEther,
        overrides: { gasLimit: 200000 },
    }).exec(account);

    await pool.mint(account.address);

    console.log("sf host address: ", superfluidHost);
    console.log("cfav1 address:   ", cfav1);
    console.log("factory address: ", factory.address);
    console.log("pool address:    ", pool.address);
    console.log("DAIAddress:      ", DAIAddress);
    console.log("USDCAddress:     ", USDCAddress);
    console.log("DAIxAddress:     ", DAIxAddress);
    console.log("USDCxAddress:    ", USDCxAddress);
};

const runMain = async () => {
    try {
        await main();
        process.exit(0);
    } catch (error) {
        console.log("Error deploying contract", error);
        process.exit(1);
    }
};

runMain();
