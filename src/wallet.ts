import {
    SolanaSignAndSendTransaction,
    type SolanaSignAndSendTransactionFeature,
    type SolanaSignAndSendTransactionMethod,
    type SolanaSignAndSendTransactionOutput,
    SolanaSignIn,
    type SolanaSignInFeature,
    type SolanaSignInMethod,
    type SolanaSignInOutput,
    SolanaSignMessage,
    type SolanaSignMessageFeature,
    type SolanaSignMessageMethod,
    type SolanaSignMessageOutput,
    SolanaSignTransaction,
    type SolanaSignTransactionFeature,
    type SolanaSignTransactionMethod,
    type SolanaSignTransactionOutput,
} from '@solana/wallet-standard-features';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import type { Wallet } from '@wallet-standard/base';
import {
    StandardConnect,
    type StandardConnectFeature,
    type StandardConnectMethod,
    StandardDisconnect,
    type StandardDisconnectFeature,
    type StandardDisconnectMethod,
    StandardEvents,
    type StandardEventsFeature,
    type StandardEventsListeners,
    type StandardEventsNames,
    type StandardEventsOnMethod,
} from '@wallet-standard/features';
import bs58 from 'bs58';
import { OWalletSolanaWalletAccount } from './account.js';
import { icon } from './icon.js';
import type { SolanaChain } from './solana.js';
import { isSolanaChain, isVersionedTransaction, SOLANA_CHAINS } from './solana.js';
import { bytesEqual } from './util.js';
import type { OWalletSolana } from './window.js';

export const OWalletSolanaNamespace = 'owalletSolana:';

export type OWalletSolanaFeature = {
    [OWalletSolanaNamespace]: {
        owalletSolana: OWalletSolana;
    };
};

export class OWalletSolanaWallet implements Wallet {
    readonly #listeners: { [E in StandardEventsNames]?: StandardEventsListeners[E][] } = {};
    readonly #version = '1.0.0' as const;
    readonly #name = 'OWallet' as const;
    readonly #icon = icon;
    #account: OWalletSolanaWalletAccount | null = null;
    readonly #owalletSolana: OWalletSolana;

    get version() {
        return this.#version;
    }

    get name() {
        return this.#name;
    }

    get icon() {
        return this.#icon;
    }

    get chains() {
        return SOLANA_CHAINS.slice();
    }

    get features(): StandardConnectFeature &
        StandardDisconnectFeature &
        StandardEventsFeature &
        SolanaSignAndSendTransactionFeature &
        SolanaSignTransactionFeature &
        SolanaSignMessageFeature &
        SolanaSignInFeature &
        OWalletSolanaFeature {
        return {
            [StandardConnect]: {
                version: '1.0.0',
                connect: this.#connect,
            },
            [StandardDisconnect]: {
                version: '1.0.0',
                disconnect: this.#disconnect,
            },
            [StandardEvents]: {
                version: '1.0.0',
                on: this.#on,
            },
            [SolanaSignAndSendTransaction]: {
                version: '1.0.0',
                supportedTransactionVersions: ['legacy', 0],
                signAndSendTransaction: this.#signAndSendTransaction,
            },
            [SolanaSignTransaction]: {
                version: '1.0.0',
                supportedTransactionVersions: ['legacy', 0],
                signTransaction: this.#signTransaction,
            },
            [SolanaSignMessage]: {
                version: '1.0.0',
                signMessage: this.#signMessage,
            },
            [SolanaSignIn]: {
                version: '1.0.0',
                signIn: this.#signIn,
            },
            [OWalletSolanaNamespace]: {
                owalletSolana: this.#owalletSolana,
            },
        };
    }

    get accounts() {
        return this.#account ? [this.#account] : [];
    }

    constructor(owalletSolana: OWalletSolana) {
        if (new.target === OWalletSolanaWallet) {
            Object.freeze(this);
        }

        this.#owalletSolana = owalletSolana;

        owalletSolana.on('connect', this.#connected, this);
        owalletSolana.on('disconnect', this.#disconnected, this);
        owalletSolana.on('accountChanged', this.#reconnected, this);

        this.#connected();
    }

    #on: StandardEventsOnMethod = (event, listener) => {
        this.#listeners[event]?.push(listener) || (this.#listeners[event] = [listener]);
        return (): void => this.#off(event, listener);
    };

    #emit<E extends StandardEventsNames>(event: E, ...args: Parameters<StandardEventsListeners[E]>): void {
        // eslint-disable-next-line prefer-spread
        this.#listeners[event]?.forEach((listener) => listener.apply(null, args));
    }

    #off<E extends StandardEventsNames>(event: E, listener: StandardEventsListeners[E]): void {
        this.#listeners[event] = this.#listeners[event]?.filter((existingListener) => listener !== existingListener);
    }

    #connected = () => {
        const address = this.#owalletSolana.publicKey?.toBase58();
        if (address) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const publicKey = this.#owalletSolana.publicKey!.toBytes();

            const account = this.#account;
            if (!account || account.address !== address || !bytesEqual(account.publicKey, publicKey)) {
                this.#account = new OWalletSolanaWalletAccount({ address, publicKey });
                this.#emit('change', { accounts: this.accounts });
            }
        }
    };

    #disconnected = () => {
        if (this.#account) {
            this.#account = null;
            this.#emit('change', { accounts: this.accounts });
        }
    };

    #reconnected = () => {
        if (this.#owalletSolana.publicKey) {
            this.#connected();
        } else {
            this.#disconnected();
        }
    };

    #connect: StandardConnectMethod = async ({ silent } = {}) => {
        if (!this.#account) {
            await this.#owalletSolana.connect(silent ? { onlyIfTrusted: true } : undefined);
        }

        this.#connected();

        return { accounts: this.accounts };
    };

    #disconnect: StandardDisconnectMethod = async () => {
        await this.#owalletSolana.disconnect();
    };

    #signAndSendTransaction: SolanaSignAndSendTransactionMethod = async (...inputs) => {
        if (!this.#account) throw new Error('not connected');

        const outputs: SolanaSignAndSendTransactionOutput[] = [];

        if (inputs.length === 1) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const { transaction, account, chain, options } = inputs[0]!;
            const { minContextSlot, preflightCommitment, skipPreflight, maxRetries } = options || {};
            if (account !== this.#account) throw new Error('invalid account');
            if (!isSolanaChain(chain)) throw new Error('invalid chain');

            const { signature } = await this.#owalletSolana.signAndSendTransaction(
                VersionedTransaction.deserialize(transaction),
                {
                    preflightCommitment,
                    minContextSlot,
                    maxRetries,
                    skipPreflight,
                }
            );

            outputs.push({ signature: bs58.decode(signature) });
        } else if (inputs.length > 1) {
            for (const input of inputs) {
                outputs.push(...(await this.#signAndSendTransaction(input)));
            }
        }

        return outputs;
    };

    #signTransaction: SolanaSignTransactionMethod = async (...inputs) => {
        if (!this.#account) throw new Error('not connected');

        const outputs: SolanaSignTransactionOutput[] = [];

        if (inputs.length === 1) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const { transaction, account, chain } = inputs[0]!;
            if (account !== this.#account) throw new Error('invalid account');
            if (chain && !isSolanaChain(chain)) throw new Error('invalid chain');

            const signedTransaction = await this.#owalletSolana.signTransaction(VersionedTransaction.deserialize(transaction));

            const serializedTransaction = isVersionedTransaction(signedTransaction)
                ? signedTransaction.serialize()
                : new Uint8Array(
                      (signedTransaction as Transaction).serialize({
                          requireAllSignatures: false,
                          verifySignatures: false,
                      })
                  );

            outputs.push({ signedTransaction: serializedTransaction });
        } else if (inputs.length > 1) {
            let chain: SolanaChain | undefined = undefined;
            for (const input of inputs) {
                if (input.account !== this.#account) throw new Error('invalid account');
                if (input.chain) {
                    if (!isSolanaChain(input.chain)) throw new Error('invalid chain');
                    if (chain) {
                        if (input.chain !== chain) throw new Error('conflicting chain');
                    } else {
                        chain = input.chain;
                    }
                }
            }

            const transactions = inputs.map(({ transaction }) => VersionedTransaction.deserialize(transaction));

            const signedTransactions = await this.#owalletSolana.signAllTransactions(transactions);

            outputs.push(
                ...signedTransactions.map((signedTransaction) => {
                    const serializedTransaction = isVersionedTransaction(signedTransaction)
                        ? signedTransaction.serialize()
                        : new Uint8Array(
                              (signedTransaction as Transaction).serialize({
                                  requireAllSignatures: false,
                                  verifySignatures: false,
                              })
                          );

                    return { signedTransaction: serializedTransaction };
                })
            );
        }

        return outputs;
    };

    #signMessage: SolanaSignMessageMethod = async (...inputs) => {
        if (!this.#account) throw new Error('not connected');

        const outputs: SolanaSignMessageOutput[] = [];

        if (inputs.length === 1) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const { message, account } = inputs[0]!;
            if (account !== this.#account) throw new Error('invalid account');

            const { signature } = await this.#owalletSolana.signMessage(message);

            outputs.push({ signedMessage: message, signature });
        } else if (inputs.length > 1) {
            for (const input of inputs) {
                outputs.push(...(await this.#signMessage(input)));
            }
        }

        return outputs;
    };

    #signIn: SolanaSignInMethod = async (...inputs) => {
        const outputs: SolanaSignInOutput[] = [];

        if (inputs.length > 1) {
            for (const input of inputs) {
                outputs.push(await this.#owalletSolana.signIn(input));
            }
        } else {
            return [await this.#owalletSolana.signIn(inputs[0])];
        }

        return outputs;
    };
}
