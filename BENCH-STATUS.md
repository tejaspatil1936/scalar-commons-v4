# Benchmarks status (#134, #192)

Status snapshot only. No `WeightInfo` wiring and no runtime changes are made here.
Measured on the LAB machine, 26 Sep 2026, at master `a5b66df`.

## Per-pallet status

| Pallet | `benchmarks.rs` | Real `#[benchmark]` fns | `runtime-benchmarks` feature | `WeightInfo` trait | Weights today |
|---|---|---|---|---|---|
| agents | yes (1 line) | 0 | yes | in `lib.rs` | hard-coded `Weight::from_parts` |
| auto-params | yes (1 line) | 0 | yes | in `lib.rs` | hard-coded |
| constitution | **no** | 0 | yes | none | n/a |
| emissions | yes (1 line) | 0 | yes | in `lib.rs` | hard-coded |
| escrow | yes (1 line) | 0 | yes | in `lib.rs` | hard-coded |
| oracle | yes (1 line) | 0 | yes | in `lib.rs` | hard-coded |
| orchestrator | yes (1 line) | 0 | yes | in `lib.rs` | hard-coded |

Six of seven pallets have a `benchmarks.rs`, and each is a one-line comment
(`// Benchmarks scaffold for pallet-<name>`). No pallet has a benchmark function.
None has a generated `weights.rs`. Constitution has no `benchmarks.rs` at all.

## Build with `--features runtime-benchmarks`

Command: `cargo build --release --features runtime-benchmarks` (workspace root).
Result: **success**, `Finished release profile in 26m 51s`, exit 0. The log is in
the evidence dir (`stderr.log`, `build-exit.txt`). The WASM runtime was also built
with the feature.

## `benchmark pallet` on lab

Command: `target/release/scalar-node benchmark pallet --chain dev --pallet '*' --extrinsic '*' --steps 2 --repeat 1`
Result: **cannot run**, exit 1:

    Error: Input("Did not find the benchmarking runtime api. ...")

Cause: `runtime/src/lib.rs` has no `frame_benchmarking::define_benchmarks!` /
`Benchmark` runtime-API impl (`grep` finds none), and the custom pallets have no
benchmark bodies. Fixing it means editing `runtime/src/lib.rs`, which this task
must not touch. **A human must add the benchmark runtime-API block there.**

## What is needed for #134 (not done here)

1. Write `#[benchmark]` functions for every extrinsic in the six pallets, plus a `Config` mock for `impl_benchmark_test_suite!`.
2. Add `define_benchmarks!` and the `Benchmark` runtime-API impl to `runtime/src/lib.rs` (human step, forbidden path).
3. Generate `weights.rs` per pallet on reference hardware, then replace the hard-coded weights with `WeightInfo`. Ship in 308.
