import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { hashPassword } from "../server/password.mjs";

if (!stdin.isTTY || !stdout.isTTY) {
  console.error("Run this command in an interactive terminal.");
  process.exitCode = 1;
} else {
  stdout.write("New admin password (hidden, minimum 12 characters): ");
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let password = "";
  let settled = false;

  const finish = async () => {
    if (settled) return;
    settled = true;
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write("\n");
    try {
      stdout.write(`${await hashPassword(password)}\n`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  };

  stdin.on("data", (character) => {
    if (character === "\u0003") {
      stdin.setRawMode(false);
      stdout.write("\n");
      process.exit(130);
    }
    if (character === "\r" || character === "\n") return void finish();
    if (character === "\u007f") password = password.slice(0, -1);
    else if (character >= " ") password += character;
  });
}
