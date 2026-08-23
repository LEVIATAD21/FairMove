"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.comparePassword = comparePassword;
const bcrypt_1 = require("bcrypt");
const SALT_ROUNDS = 12;
async function hashPassword(password) {
    return (0, bcrypt_1.hash)(password, SALT_ROUNDS);
}
async function comparePassword(plainPassword, hashedPassword) {
    return (0, bcrypt_1.compare)(plainPassword, hashedPassword);
}
//# sourceMappingURL=password.js.map