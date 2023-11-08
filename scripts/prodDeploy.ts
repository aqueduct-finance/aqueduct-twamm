/**
 *
 * Deploys the factory and router contracts
 *
 * to run: 
 * (testing on mumbai): npx hardhat run --network mumbai scripts/prodDeploy.ts
 * (prod on polygon main): npx hardhat run --network polygon scripts/prodDeploy.ts
 *
 */

import hre from "hardhat";

const superfluidHost = "0x3E14dC1b13c488a8d5D310918780c983bD5982E7";
const feeToSetter = "0xEBEddF028290cb0562f395699Ab764fd278a04cd";

// delays x number of seconds
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

const main = async () => {

    // deploy factory
    const Factory = await hre.ethers.getContractFactory("AqueductV1Factory");
    const factory = await Factory.deploy(feeToSetter, superfluidHost);

    console.log('factory: ', factory.address);

    await delay(30000); // wait 30s

    // verify factory on polygonscan
    await hre.run("verify:verify", {
        address: factory.address,
        constructorArguments: [feeToSetter, superfluidHost],
    });

    // deploy router 
    const Router = await hre.ethers.getContractFactory("AqueductV1Router");
    const router = await Router.deploy(factory.address);

    console.log('router: ', router.address);

    await delay(30000);

    // verify router on polygonscan
    await hre.run("verify:verify", {
        address: router.address,
        constructorArguments: [factory.address],
    });
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