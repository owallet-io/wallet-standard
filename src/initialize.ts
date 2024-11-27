import { registerWallet } from './register.js';
import { OWalletSolanaWallet } from './wallet.js';
import type { OWalletSolana } from './window.js';

export function initialize(owalletSolana: OWalletSolana): void {
    registerWallet(new OWalletSolanaWallet(owalletSolana));
}
