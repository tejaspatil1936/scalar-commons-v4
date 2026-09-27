# Release notes — spec 307

What changes for anything that *talks to* the chain: clients, SDKs, bots and test
harnesses. Runtime-internal changes that no caller can observe are not listed here.

Check what you are actually connected to before reading further — these notes describe
runtime `specVersion` 307, and the published guides were captured against 305/306:

```js
(await api.rpc.state.getRuntimeVersion()).specVersion.toNumber()
```

## Breaking changes for clients

### `escrow.create_agreement` rejects an over-long `deliver_by` instead of clamping it

**Before spec 307**, a `deliver_by` further out than the runtime's `MaxAgreementSpan`
allowed was **silently clamped** down to the maximum. The call succeeded, funds were
reserved, and the agreement you got back carried a deadline you never asked for.

**From spec 307** (E21, PR #198) the same call fails with
`escrow::Error::SpanTooLong`. Nothing is reserved and no agreement is created — the
guard sits ahead of the `reserve()`, so a rejected submission leaves your balance
untouched apart from the transaction fee.

Over a polkadot-js client this surfaces as a module error on an *included* extrinsic:

```text
escrow.SpanTooLong: The requested deadline is further out than MaxAgreementSpan allows (E21).
```

The change is deliberate. A buyer locks real funds against the deadline they signed;
quietly substituting a different one means the provider is held to a schedule the buyer
never agreed to, and the buyer has no way to notice. Failing loudly is the honest
outcome, and it is covered by unit tests in `pallets/escrow/src/tests.rs`.

`escrow.extend_deadline` enforces the same bound, also with `SpanTooLong`. A client that
extends deadlines needs the same fix, not just one that creates agreements.

#### What a client should do

Clamp before you submit, not after you fail. Read the bound out of chain metadata and
cap your own deadline against it:

```js
const span = api.consts.escrow.maxAgreementSpan.toNumber();
const now  = (await api.rpc.chain.getHeader()).number.toNumber();

// Never ask for more span than this runtime allows.
const deliverBy = Math.min(wantedDeliverBy, now + span);
await api.tx.escrow.createAgreement(provider, amount, hash, deliverBy, cap).signAndSend(buyer);
```

Do **not** hard-code the bound. It is a runtime constant, it differs between the local
devnet and the public testnet, and a governance or runtime upgrade can move it without
telling your client. Metadata is the only value that is true for the chain you are
actually connected to — which is also why this page does not print the number.

#### `SpanTooLong` is deterministic — never retry it

The outcome is a pure function of the call's arguments and the current block height.
A resubmission of the same `deliver_by` produces the same error, and because the
extrinsic *was* included, every attempt pays a full transaction fee. Retrying a
`SpanTooLong` submission four times buys four identical failures and four fees. This is
the same fee-burning shape measured for `MinDeliveryBlocksNotElapsed` in
[the tester guide](/guide/testnet-tester-guide#the-escrow-lifecycle) ([issue #160](https://github.com/tejaspatil1936/scalar-commons-v4/issues/160)).

Recompute the deadline from a fresh head and the metadata bound, then submit once.

::: warning `@scalar-commons/sdk` still retries this one
As of this release the SDK's retry classifier (`isDeterministicFailure` in
`sdk/src/errors.ts`) recognises `MinDeliveryBlocksNotElapsed`, `BadOrigin` and
`Insufficient*`, but **not** `SpanTooLong` — so `withRetry` will resubmit a
`SpanTooLong` failure up to three more times and pay a fee for each. Until that is
fixed, either clamp `deliverBy` yourself as shown above, or pass `maxRetries: 0` for
`createEscrow`. Adding `SpanTooLong` to the classifier is tracked as SDK work outside
this runtime release.
:::
