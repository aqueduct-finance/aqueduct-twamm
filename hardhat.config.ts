import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-preprocessor";
import fs from "fs";
import * as dotenv from "dotenv";
import "./tasks/accounts";

dotenv.config();

function getRemappings() {
    return fs
        .readFileSync("remappings.txt", "utf8")
        .split("\n")
        .filter(Boolean) // remove empty lines
        .map((line) => line.trim().split("="));
}

const config: HardhatUserConfig = {
    networks: {
        hardhat: {
            blockGasLimit: 30000000,
        },
        goerli: {
            url: process.env.GOERLI_URL || "",
            accounts: [process.env.PRIVATE_KEY || ""],
        },
        sepolia: {
            url: process.env.SEPOLIA_URL || "",
            accounts: [process.env.PRIVATE_KEY || ""],
        },
        mumbai: {
            url: process.env.MUMBAI_URL || "",
            accounts: [process.env.PRIVATE_KEY || ""],
        }
    },
    etherscan: {
        apiKey: process.env.POLYGONSCAN_API_KEY,
    },
    solidity: {
        version: "0.8.12",
        settings: {
            optimizer: {
                enabled: true,
                runs: 9999,
            },
            metadata: {
                bytecodeHash: "none",
            },
        },
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS !== undefined,
        currency: "USD",
    },
    typechain: {
        outDir: "typechain-types",
        target: "ethers-v5",
    },
    preprocess: {
        eachLine: (hre) => ({
            transform: (line: string) => {
                if (line.match(/^\s*import /i)) {
                    for (const [from, to] of getRemappings()) {
                        if (line.includes(from)) {
                            line = line.replace(from, to);
                            break;
                        }
                    }
                }
                return line;
            },
        }),
    },
    paths: {
        sources: "./src",
        cache: "./cache_hardhat",
    },
};

export default config;
