/**
 *
 * Deploys just the core contract for a pair
 *
 * to run: npx hardhat run --network mumbai scripts/deployAll.ts
 *
 */

import hre from "hardhat";

import { Framework } from "@superfluid-finance/sdk-core";
const superfluidHost = "0xEB796bdb90fFA0f28255275e16936D25d3418603";
const fDAIAddress = "0x15f0ca26781c3852f8166ed2ebce5d18265cceb7";
const fUSDCAddress = "0xbe49ac1eadac65dccf204d4df81d650b50122ab2";
const fDAIxAddress = "0x5d8b4c2554aeb7e86f387b4d6c00ac33499ed01f";
const fUSDCxAddress = "0x42bb40bf79730451b11f6de1cba222f17b87afd7";

const erc20Abi = '[{"inputs":[{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"symbol","type":"string"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"subtractedValue","type":"uint256"}],"name":"decreaseAllowance","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"addedValue","type":"uint256"}],"name":"increaseAllowance","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"mint","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"sender","type":"address"},{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"}]';


const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

const main = async () => {

    // get signer/account
    const accounts = await hre.ethers.getSigners();
    const account = accounts[0];

    // deploy factory and pool
    const Factory = await hre.ethers.getContractFactory("AqueductV1Factory");
    const factory = await Factory.deploy(account.address, superfluidHost);

    console.log('factory: ', factory.address)

    await delay(10000);
    await hre.run("verify:verify", {
        address: factory.address,
        constructorArguments: [account.address, superfluidHost],
    });

    const auctionAddress = await factory.auction();

    console.log('auction: ', auctionAddress);

    await factory.createPair(fDAIxAddress, fUSDCxAddress);

    await delay(10000);

    const superApp = (await hre.ethers.getContractFactory("AqueductV1Pair")).attach(
        await factory.getPair(fDAIxAddress, fUSDCxAddress)
    );

    console.log("pool: ", superApp.address);

    await delay(10000);
    await hre.run("verify:verify", {
        address: superApp.address,
        constructorArguments: [],
    });

    const Router = await hre.ethers.getContractFactory("AqueductV1Router");
    const router = await Router.deploy(factory.address);

    console.log('router: ', router.address)

    await delay(10000);
    await hre.run("verify:verify", {
        address: router.address,
        constructorArguments: [factory.address],
    });

    // init sf
    const sf = await Framework.create({
        chainId: 80001,
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