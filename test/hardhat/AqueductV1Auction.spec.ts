import { expect } from "chai";
import { BigNumber, constants as ethconst, Contract } from "ethers";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { expandTo18Decimals } from "./shared/utilities";
import { AqueductV1Pair } from "../../typechain-types";
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

// erc20 abi, used to correctly check for Transfer event
const erc20Abi = ["event Transfer(address indexed from, address indexed to, uint256 value)"];

before(async function () {
    // get hardhat accounts
    let other: SignerWithAddress;
    [owner, other] = await ethers.getSigners();
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

        // do the same for the second wlalet
        // minting test token
        await underlyingToken.mint(other.address, ethers.utils.parseEther("10000").toString());

        // approving DAIx to spend DAI (Super Token object is not an ethers contract object and has different operation syntax)
        await underlyingToken.connect(other).approve(superToken.address, ethers.constants.MaxInt256);
        // Upgrading all DAI to DAIx
        const otherUpgrade = superToken.upgrade({
            amount: ethers.utils.parseEther("10000").toString(),
        });
        await otherUpgrade.exec(other);
    };

    await setupToken(baseTokenA, tokenA);
    await setupToken(baseTokenB, tokenB);
});

describe("AqueductV1Auction", () => {
    async function fixture() {
        const [wallet, other, attacker] = await ethers.getSigners();

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

        const auction = (await ethers.getContractFactory("AqueductV1Auction")).attach(await factory.auction());

        return { pair, token0, token1, wallet, other, factory, auction, attacker };
    }

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

    it("auction:token0", async () => {
        const { pair, wallet, token0, token1, auction } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const totalSwapAmount = expandTo18Decimals(1);
        const bidAmount = totalSwapAmount.mul(3).div(1000); // minimum bid == 0.3% fee
        const swapAmount = totalSwapAmount.sub(bidAmount);
        const expectedOutputAmount = BigNumber.from("1662497915624478906");

        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);

        await expect(auction.placeBid(token0.address, pair.address, bidAmount, swapAmount, ethers.constants.MaxUint256))
            .to.emit(pair, "Swap")
            .withArgs(auction.address, swapAmount, 0, 0, expectedOutputAmount, auction.address);

        await expect(auction.executeWinningBid(pair.address))
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer") // send bid to pair
            .withArgs(auction.address, pair.address, bidAmount)
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer") // send funds back to user
            .withArgs(auction.address, wallet.address, expectedOutputAmount);
    });

    it("auction:token1", async () => {
        const { pair, wallet, token0, token1, auction } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(10);
        const token1Amount = expandTo18Decimals(5);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const totalSwapAmount = expandTo18Decimals(1);
        const bidAmount = totalSwapAmount.mul(3).div(1000); // minimum bid == 0.3% fee
        const swapAmount = totalSwapAmount.sub(bidAmount);
        const expectedOutputAmount = BigNumber.from("1662497915624478906");

        await token1
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);

        await expect(auction.placeBid(token1.address, pair.address, bidAmount, swapAmount, ethers.constants.MaxUint256))
            .to.emit(pair, "Swap")
            .withArgs(auction.address, 0, swapAmount, expectedOutputAmount, 0, auction.address);

        await expect(auction.executeWinningBid(pair.address))
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer") // send bid to pair
            .withArgs(auction.address, pair.address, bidAmount)
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer") // send funds back to user
            .withArgs(auction.address, wallet.address, expectedOutputAmount);
    });

    it("auction:token_under_min_bid", async () => {
        const { pair, wallet, token0, token1, auction } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const totalSwapAmount = expandTo18Decimals(1);
        const bidAmount = totalSwapAmount.mul(3).div(1000).sub(1); // under minimum bid (<0.3%)
        const swapAmount = totalSwapAmount.sub(bidAmount);

        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);

        await expect(
            auction.placeBid(token0.address, pair.address, bidAmount, swapAmount, ethers.constants.MaxUint256)
        ).to.be.revertedWithCustomError(auction, "AUCTION_INSUFFICIENT_BID");

        await auction.placeBid(
            token0.address,
            pair.address,
            bidAmount.add(1), // now exactly equal to 0.3% fee
            swapAmount,
            ethers.constants.MaxUint256
        );
    });

    it("auction:approval", async () => {
        const { pair, wallet, token0, token1, auction } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const totalSwapAmount = expandTo18Decimals(1);
        const bidAmount = totalSwapAmount.mul(3).div(1000); // minimum bid == 0.3% fee
        const swapAmount = totalSwapAmount.sub(bidAmount);

        // bad approval
        await token0
            .approve({
                receiver: auction.address,
                amount: totalSwapAmount.sub(1),
            })
            .exec(wallet);
        await expect(
            auction.placeBid(token0.address, pair.address, bidAmount, swapAmount, ethers.constants.MaxUint256)
        ).to.be.revertedWithCustomError(auction, "TRANSFERHELPER_TRANSFER_FROM_FAILED");

        // good approval
        await token0
            .approve({
                receiver: auction.address,
                amount: totalSwapAmount,
            })
            .exec(wallet);
        await auction.placeBid(token0.address, pair.address, bidAmount, swapAmount, ethers.constants.MaxUint256);
    });

    it("auction:bids_in_separate_blocks", async () => {
        const { pair, wallet, token0, token1, auction, other } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        // get initial user balance
        const initialUserBalance = await token0.balanceOf({
            account: wallet.address,
            providerOrSigner: ethers.provider,
        });

        // first bid
        const bid1 = expandTo18Decimals(1);
        const swapAmount = expandTo18Decimals(1);
        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);
        await expect(auction.placeBid(token0.address, pair.address, bid1, swapAmount, ethers.constants.MaxUint256))
            .to.emit(pair, "Swap")
            .withArgs(auction.address, swapAmount, 0, 0, "1666666666666666666", auction.address);

        // second bid
        const bid2 = expandTo18Decimals(2);
        const swapAmount2 = expandTo18Decimals(2);
        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(other);
        // placing a bid in a new block should execute the previous auction
        // (hardhat automatically mines each time, so this is a new block)
        await expect(
            await auction
                .connect(other)
                .placeBid(token0.address, pair.address, bid2, swapAmount2, ethers.constants.MaxUint256)
        )
            .to.emit(pair, "Swap")
            .withArgs(auction.address, swapAmount2, 0, 0, "1851851851851851852", auction.address)
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer") // send bid to pair
            .withArgs(auction.address, pair.address, bid1)
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer") // send funds back to user
            .withArgs(auction.address, wallet.address, "1666666666666666666");

        // check that the second amount was swapped
        await expect(auction.executeWinningBid(pair.address))
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer") // send bid to pair
            .withArgs(auction.address, pair.address, bid2)
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer") // send funds back to user
            .withArgs(auction.address, other.address, "1851851851851851852");
    });

    it("auction:losing_bid_first", async () => {
        const { pair, wallet, token0, token1, auction, other } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        // get initial user balance
        const initialUserBalance = await token0.balanceOf({
            account: wallet.address,
            providerOrSigner: ethers.provider,
        });

        // Disable automining, so that both transactions are in the same block
        await network.provider.send("evm_setAutomine", [false]);

        // smaller bid first
        const smallBid = expandTo18Decimals(1);
        const swapAmount = expandTo18Decimals(1);
        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);
        const firstBid = auction.placeBid(
            token0.address,
            pair.address,
            smallBid,
            swapAmount,
            ethers.constants.MaxUint256
        );

        // larger bid second (winning bid)
        const largerBid = expandTo18Decimals(2);
        const swapAmount2 = expandTo18Decimals(2);
        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(other);
        const secondBid = auction
            .connect(other)
            .placeBid(token0.address, pair.address, largerBid, swapAmount2, ethers.constants.MaxUint256);

        await network.provider.send("evm_setAutomine", [true]);
        await network.provider.send("evm_mine");

        await firstBid;

        await expect(secondBid)
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer") // send funds back to user
            .withArgs(auction.address, wallet.address, swapAmount.add(smallBid).sub(1)) // user loses small dust amount
            .to.emit(pair, "Swap")
            .withArgs(auction.address, swapAmount2, 0, 0, "2857142857142857142", auction.address);

        // check that first user got their funds back
        const currentUserBalance = await token0.balanceOf({
            account: wallet.address,
            providerOrSigner: ethers.provider,
        });
        expect(BigNumber.from(currentUserBalance).add(1).toString()).to.equal(initialUserBalance); // user loses small dust amount

        // check that the second amount was swapped
        await expect(auction.executeWinningBid(pair.address))
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer") // send bid to pair
            .withArgs(auction.address, pair.address, largerBid)
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer") // send funds back to user
            .withArgs(auction.address, other.address, "2857142857142857142");
    });

    it("auction:winning_bid_first", async () => {
        const { pair, wallet, token0, token1, auction, other } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        // Disable automining, so that both transactions are in the same block
        await network.provider.send("evm_setAutomine", [false]);

        // larger bid first (winning bid)
        const largerBid = expandTo18Decimals(2);
        const swapAmount = expandTo18Decimals(2);
        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);
        await auction.placeBid(token0.address, pair.address, largerBid, swapAmount, ethers.constants.MaxUint256);

        // smaller bid second
        const smallerBid = expandTo18Decimals(1);
        const swapAmount2 = expandTo18Decimals(1);
        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(other);

        await network.provider.send("evm_setAutomine", [true]);
        await expect(
            auction
                .connect(other)
                .placeBid(token0.address, pair.address, smallerBid, swapAmount2, ethers.constants.MaxUint256)
        ).to.be.revertedWithCustomError(auction, "AUCTION_INSUFFICIENT_BID");

        // check that the first amount is swapped
        await expect(auction.executeWinningBid(pair.address))
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer") // send bid to pair
            .withArgs(auction.address, pair.address, largerBid)
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer") // send funds back to user
            .withArgs(auction.address, wallet.address, "2857142857142857142");
    });

    it("auction:bid0,1", async () => {
        const { pair, wallet, token0, token1, auction, other } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        // Disable automining, so that both transactions are in the same block
        await network.provider.send("evm_setAutomine", [false]);

        // larger bid first in token0 (winning bid)
        const largerBid = expandTo18Decimals(2);
        const swapAmount = expandTo18Decimals(2);
        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);
        await auction.placeBid(token0.address, pair.address, largerBid, swapAmount, ethers.constants.MaxUint256);

        // smaller bid second in token1
        const smallerBid = largerBid.mul(token1Amount).div(token0Amount).sub(1); // convert token0->token1 and subtract 1 wei so the bid is smaller
        const swapAmount2 = expandTo18Decimals(2);
        await token1
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(other);

        // add both transactions to same block
        const failingTx = auction
            .connect(other)
            .placeBid(token1.address, pair.address, smallerBid, swapAmount2, ethers.constants.MaxUint256);
        const passingTx = auction
            .connect(other)
            .placeBid(token1.address, pair.address, smallerBid.add(1), swapAmount2, ethers.constants.MaxUint256);

        // mine block
        await network.provider.send("evm_setAutomine", [true]);
        await network.provider.send("evm_mine");

        // check that first transaction revert and second didn't
        await expect(failingTx).to.be.revertedWithCustomError(auction, "AUCTION_INSUFFICIENT_BID");

        await passingTx;

        // check that the second amount is swapped
        await expect(auction.executeWinningBid(pair.address))
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer") // send bid to pair
            .withArgs(auction.address, pair.address, smallerBid.add(1))
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer") // send funds back to user
            .withArgs(auction.address, other.address, "1968749999999999999");
    });

    it("auction:bid1,0", async () => {
        const { pair, wallet, token0, token1, auction, other } = await loadFixture(fixture);

        const token0Amount = expandTo18Decimals(5);
        const token1Amount = expandTo18Decimals(10);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        // Disable automining, so that both transactions are in the same block
        await network.provider.send("evm_setAutomine", [false]);

        // larger bid first in token0 (winning bid)
        const largerBid = expandTo18Decimals(2);
        const swapAmount = expandTo18Decimals(2);
        await token1
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);
        await auction.placeBid(token1.address, pair.address, largerBid, swapAmount, ethers.constants.MaxUint256);

        // smaller bid second in token1
        const smallerBid = largerBid.mul(token0Amount).div(token1Amount).sub(1); // convert token1->token0 and subtract 1 wei so the bid is smaller
        const swapAmount2 = expandTo18Decimals(2);
        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(other);

        // add both transactions to same block
        const failingTx = auction
            .connect(other)
            .placeBid(token0.address, pair.address, smallerBid, swapAmount2, ethers.constants.MaxUint256);
        const passingTx = auction
            .connect(other)
            .placeBid(token0.address, pair.address, smallerBid.add(1), swapAmount2, ethers.constants.MaxUint256);

        // mine block
        await network.provider.send("evm_setAutomine", [true]);
        await network.provider.send("evm_mine");

        // check that first transaction revert and second didn't
        await expect(failingTx).to.be.revertedWithCustomError(auction, "AUCTION_INSUFFICIENT_BID");

        await passingTx;

        // check that the second amount is swapped
        await expect(auction.executeWinningBid(pair.address))
            .to.emit(new ethers.Contract(token0.address, erc20Abi, owner), "Transfer") // send bid to pair
            .withArgs(auction.address, pair.address, smallerBid.add(1))
            .to.emit(new ethers.Contract(token1.address, erc20Abi, owner), "Transfer") // send funds back to user
            .withArgs(auction.address, other.address, "4540540540540540540");
    });

    /**************************************************************************
     * tests below are related to exploits found in the first audit
     *************************************************************************/

    // issue: Reentrancy with a fake token in AqueductV1Auction | critical | (test #1)
    // added reentrancy lock to placeBid(), test that the exploit contract now fails
    it("auction:reentrancy-hack", async () => {
        const { factory, wallet, token0, auction, attacker } = await loadFixture(fixture);

        const exploitToken = await (await ethers.getContractFactory("ExploitToken")).connect(attacker).deploy(true);
        await factory.createPair(token0.address, exploitToken.address);
        const pair = (await ethers.getContractFactory("AqueductV1Pair")).attach(
            await factory.getPair(token0.address, exploitToken.address)
        );

        await exploitToken.connect(attacker).initialize(auction.address, pair.address);

        const token0Amount = expandTo18Decimals(1000);
        const token1Amount = expandTo18Decimals(1000);
        const AucToken0Amount = expandTo18Decimals(100);
        const AucToken1Amount = expandTo18Decimals(100);

        await exploitToken.connect(wallet).mint(expandTo18Decimals(10000));
        await exploitToken.connect(attacker).mint(expandTo18Decimals(100));

        // add liquidity
        await token0
            .transfer({
                receiver: pair.address,
                amount: token0Amount,
            })
            .exec(wallet);
        await exploitToken.connect(wallet).transfer(pair.address, token1Amount);
        await pair.mint(wallet.address);

        await exploitToken.connect(wallet).transfer(attacker.address, expandTo18Decimals(10));

        // Imagine the auction contract is active
        await token0
            .transfer({
                receiver: auction.address,
                amount: AucToken0Amount,
            })
            .exec(wallet);

        await exploitToken.connect(wallet).transfer(auction.address, AucToken1Amount);

        // exploit
        const swapExploitAmount = expandTo18Decimals(10);
        const bidExploitAmount = expandTo18Decimals(1);

        // without this transfer swap in placeBid() will fail
        await exploitToken.connect(attacker).transfer(pair.address, swapExploitAmount);

        // _safeTransfer will fail with AUCTION_LOCKED, but reverts with its own error message
        await expect(
            auction
                .connect(attacker)
                .placeBid(
                    exploitToken.address,
                    pair.address,
                    bidExploitAmount,
                    swapExploitAmount,
                    ethers.constants.MaxUint256
                )
        ).to.be.revertedWithCustomError(auction, "AUCTION_TRANSFER_FAILED");
    });

    // issue: Reentrancy with a fake token in AqueductV1Auction | critical | (test #2)
    // if the token is not in the pair, check for revert
    it("auction:token-not-in-pair", async () => {
        const { pair, wallet, token0, token1, auction, attacker } = await loadFixture(fixture);

        // try to bid with malicious token that is not in the pair
        const swapExploitAmount = expandTo18Decimals(10);
        const bidExploitAmount = expandTo18Decimals(10000000);
        const exploitToken = await (await ethers.getContractFactory("ExploitToken")).connect(attacker).deploy(false);

        await expect(
            auction
                .connect(attacker)
                .placeBid(
                    exploitToken.address,
                    pair.address,
                    bidExploitAmount,
                    swapExploitAmount,
                    ethers.constants.MaxUint256
                )
        ).to.be.revertedWithCustomError(auction, "AUCTION_TOKEN_NOT_IN_PAIR");
    });

    // issue: Possibility of stealing funds by using a malicious pair contract | critical
    // auction.placeBid() should revert if the pair contract is invalid (not deployed by the factory)
    it("auction:hack-with-custom-pair", async () => {
        const { pair, wallet, token0, token1, auction, other } = await loadFixture(fixture);
        const hacker = other;
        const token0Amount = expandTo18Decimals(1000);
        const token1Amount = expandTo18Decimals(1000);
        await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount);

        const bid = expandTo18Decimals(10);
        const swapAmount = expandTo18Decimals(100);
        let reserves = await pair.getReserves();

        const poc = await (await ethers.getContractFactory("ExploitPair"))
            .connect(hacker)
            .deploy(token0.address, token1.address, auction.address, reserves.reserve0, reserves.reserve1);

        await token0
            .transfer({
                receiver: poc.address,
                amount: bid.add(swapAmount),
            })
            .exec(wallet);

        await token0
            .approve({
                from: hacker.address,
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);

        // user places bid
        await token0
            .approve({
                receiver: auction.address,
                amount: ethers.constants.MaxInt256,
            })
            .exec(wallet);

        await auction.placeBid(token0.address, pair.address, bid, swapAmount, ethers.constants.MaxUint256);

        // attacker places bid with custom pair contract
        await expect(poc.connect(hacker).attackPlaceBid(bid, swapAmount)).to.be.revertedWithCustomError(
            auction,
            "AUCTION_INVALID_PAIR"
        );
    });

    // test re-entrancy lock on executeWinningBid
    it("auction:reentrancy-executeWinningBid", async () => {
        const { factory, wallet, token0, auction, attacker } = await loadFixture(fixture);

        const exploitToken = await (await ethers.getContractFactory("ExploitToken")).connect(attacker).deploy(false);
        await factory.createPair(token0.address, exploitToken.address);
        const pair = (await ethers.getContractFactory("AqueductV1Pair")).attach(
            await factory.getPair(token0.address, exploitToken.address)
        );

        await exploitToken.connect(attacker).initialize(auction.address, pair.address);

        const token0Amount = expandTo18Decimals(1000);
        const token1Amount = expandTo18Decimals(1000);
        const AucToken0Amount = expandTo18Decimals(100);
        const AucToken1Amount = expandTo18Decimals(100);

        await exploitToken.connect(wallet).mint(expandTo18Decimals(10000));
        await exploitToken.connect(attacker).mint(expandTo18Decimals(100));

        // add liquidity
        await token0
            .transfer({
                receiver: pair.address,
                amount: token0Amount,
            })
            .exec(wallet);
        await exploitToken.connect(wallet).transfer(pair.address, token1Amount);
        await pair.mint(wallet.address);

        await exploitToken.connect(wallet).transfer(attacker.address, expandTo18Decimals(10));

        // Imagine the auction contract is active
        await token0
            .transfer({
                receiver: auction.address,
                amount: AucToken0Amount,
            })
            .exec(wallet);

        await exploitToken.connect(wallet).transfer(auction.address, AucToken1Amount);

        // exploit
        const swapExploitAmount = expandTo18Decimals(10);
        const bidExploitAmount = expandTo18Decimals(1);

        // without this transfer swap in placeBid() will fail
        await exploitToken.connect(attacker).transfer(pair.address, swapExploitAmount);

        await auction
            .connect(attacker)
            .placeBid(
                exploitToken.address,
                pair.address,
                bidExploitAmount,
                swapExploitAmount,
                ethers.constants.MaxUint256
            );

        // _safeTransfer will fail with AUCTION_LOCKED, but reverts with its own error message
        await expect(auction.executeWinningBid(pair.address)).to.be.revertedWithCustomError(
            auction,
            "AUCTION_TRANSFER_FAILED"
        );
    });
});
