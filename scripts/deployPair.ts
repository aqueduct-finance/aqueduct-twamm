/**
 *
 * Deploys just the core contract for a pair
 *
 * to run: npx hardhat run --network goerli scripts/deployPair.js
 *
 */

import hre from "hardhat";

import { Framework } from "@superfluid-finance/sdk-core";
const superfluidHost = "0x22ff293e14F1EC3A09B137e9e06084AFd63adDF9";
const cfav1 = "0xEd6BcbF6907D4feEEe8a8875543249bEa9D308E8";
const fDAIAddress = "0x88271d333C72e51516B67f5567c728E702b3eeE8";
const fUSDCAddress = "0xc94dd466416A7dFE166aB2cF916D3875C049EBB7";
const fDAIxAddress = "0xF2d68898557cCb2Cf4C10c3Ef2B034b2a69DAD00";
const fUSDCxAddress = "0x8aE68021f6170E5a766bE613cEA0d75236ECCa9a";

const erc20Abi = '[{"inputs":[{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"symbol","type":"string"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"subtractedValue","type":"uint256"}],"name":"decreaseAllowance","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"addedValue","type":"uint256"}],"name":"increaseAllowance","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"mint","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"sender","type":"address"},{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"}]';


const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

const main = async () => {

    // get signer/account
    const accounts = await hre.ethers.getSigners();
    const account = accounts[0];

    // deploy factory and pool
    const Factory = await hre.ethers.getContractFactory("UniswapV2Factory");
    const factory = await Factory.deploy(account.address, superfluidHost);

    console.log(factory.address)

    await delay(5000);

    await factory.createPair(fDAIxAddress, fUSDCxAddress);

    await delay(25000);
    console.log(await factory.getPair(fUSDCxAddress, fDAIxAddress));
    const superApp = (await hre.ethers.getContractFactory("UniswapV2Pair")).attach(
        await factory.getPair(fDAIxAddress, fUSDCxAddress)
    );

    console.log("Pool: ", superApp.address);

    await delay(5000);

    /*
    await hre.run("verify:verify", {
        address: superApp.address,
        constructorArguments: [superfluidHost],
    });*/

    // init sf
    const sf = await Framework.create({
        chainId: 5,
        provider: hre.ethers.provider
    });

    // get some super tokens
    const fDAI = new hre.ethers.Contract(fDAIAddress, erc20Abi, account);
    const fUSDC = new hre.ethers.Contract(fUSDCAddress, erc20Abi, account)
    const tokenAmount = "1000000000000000000000000";
    await fDAI.mint(account.address, tokenAmount);
    await delay(5000);
    await fUSDC.mint(account.address, tokenAmount);
    await delay(5000);
    await fDAI.approve(fDAIxAddress, tokenAmount);
    await delay(5000);
    await fUSDC.approve(fUSDCxAddress, tokenAmount);
    await delay(5000);
    const fDAIx = await sf.loadSuperToken(fDAIxAddress);
    const fUSDCx = await sf.loadSuperToken(fUSDCxAddress);

    const upgradeOperation0 = fDAIx.upgrade({
        amount: tokenAmount
    });
    await upgradeOperation0.exec(account);
    await delay(5000);

    const upgradeOperation1 = fUSDCx.upgrade({
        amount: tokenAmount
    });
    await upgradeOperation1.exec(account);

    await delay(5000);

    // LP
    await fDAIx
        .transfer({
            receiver: superApp.address,
            amount: tokenAmount,
        })
        .exec(account);
    await delay(5000);

    await fUSDCx
        .transfer({
            receiver: superApp.address,
            amount: tokenAmount,
        })
        .exec(account);
    await delay(5000);

    await superApp.mint(account.address);
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
