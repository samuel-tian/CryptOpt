# Technical Documentation

## Overall directory structure

- `modules`: git-submodules. Currently contains [0xADE1A1DE/MeasureSuite](https://github.com/0xADE1A1DE/MeasureSuite).
- `src`: source files for CryptOpt
- `src/bridge`: We call a class, which provides a `JSON`-format of the input function and generates machine code a **Bridge**. Those are in this folder, currently supported are `fiat-bridge` and `bitcoin-core-bridge`. Additionally an experimental `manual-bridge`, where one can specify a C and JSON source file to run the optimization on.
- `test`: unit and e2e-tests

## Tool chain

CryptOpt is written in [TypeScript](https://www.typescriptlang.org/), a typed superset of JavaScript.
`./build.sh` gets the Node runtime, triggers MeasureSuite compilation and triggers the transpilation of CryptOpt to JavaScript and then bundles with `rollup` to one file `dist/CryptOpt.js`.
`./run.sh` serves as a wrapper script, essentially calling `node ./dist/CryptOpt.js` with the local node version.
The optimization then runs in the Chrome V8 engine through Node.js.

## Files

The general entry point is `CryptOpt.ts`.
Output is then written to the `results/<CURVE>/<METHOD>/`, can be changed with the `--resultDir` option.
For each run, it generates an `*.asm` file and a state (`seed<SEED>.json`) file, that is, for each of the `bet`s.
Additionally, we generate one `seed<SEED>.dat`,`seed<SEED>.gp` and `seed<SEED>.pdf` file.
The `dat` contains the ratio over time in each line and doubles as an input for the `gp` file, which executed with `gnuplot`, generates the `pdf`.

## Dependencies

CryptOpt is dependent on `MeasureSuite`. In a nutshell, CryptOpt gives `MeasureSuite` two assembly strings and `MeasureSuite` will then evaluate them in our adapted R3-Validation fashion.
It itself is written in C, but provides TypeScript bindings.
It also depends on [AssemblyLine](https://github.com/0XADE1A1DE/Assemblyline) (*An ultra-lightweight C library and binary for generating machine code of x86_64 assembly language and executing on the fly*) to generate and execute machine code.

## How does it work then?

Lets dive into how the optimization works.

`CryptOpt.js` creates an instance of `Optimizer` from `optimizer/optimizer.class.ts`, the constructor of which 
- initializes the *Model* (`optimizer/Optimizer.helper.class.ts` contains the set-ups for the Bridges) which is our representation of the input function. It stores the operations, the order, decisions; on its instance the mutations are performed.
- generates the machine code from the given C file
- set ups MeasureSuite with parameters of the function's shape.
If the optimizer is started with `--readState` we import that state in the constructor, too.

Initializing the *Model* also analyses the operations, rewrites some hierarchies in the JSON, and sets up internal data structures.

### Genetic Improvement flow

1. Assemble the current code (`assemble` call in line `optimizer/optimizer.class.ts:197`); will assemble the JS-operations into an assembly-string.
1. Because `numEvals` is zero at first, we increment (line 217) and jump back to 193, where we do the mutation. Paul (our stateful random oracle for everything) chooses whether to mutate P or D. The mutation is done in line 76 or 85. We also prepare the function to revert the mutation in case we want to discard it.
1. After the mutation, `this.measuresuite.measure` (line 227) measures both function with `batchSize` and `numBatches` (bs, nob).
1. We sanity check if all is correct.
1. In lines 303--307 we check if the mutated version is better.
1. We write the status line by calling the `genStatusLine` method.
1. When the optimization is done (`evals` exhausted), we write the result assembly file by calling `writeCurrentAsm`. This method will then call the Fiat equivalence checker (line 169+173), and exit the optimization, if the validation failed. Note: The build command, built in the FiatBridge, is similar to the code generation command, but this time mainly features the `--hints-file` switch with the just-written ASM file.


### Assembly generation

The `assemble` method assembles the JS-Data into an ASM-string.
It does so by sequentially going through the operations (`assembler/assembler.ts:19`) and getting the instruction(s) for this particular operation.
The rest of that file is pretty much boilerplate and error handling.

The instructions are generated from `instructionGeneration/InstructionGenerator.ts`, a big switch statements proxying to the templates.

The context at each instruction is kept in the singleton instance of `registerAllocator/RegisterAllocator.class.ts`. Each of the templates are called with the operation `o`.
Those templates then analyze the operation, *requests* the registers holding the needed values and for spare registers to save the value into from the `RegisterAllocator`.
Within such requests, there are `AllocationFlags` on what the instruction needs. E.g. *will clear CF-flag, spill it if needed* or *can read immediate values* (c.f. `enums/AllocationFlags.enum.ts`).
The `RegisterAllocator` then takes care of those circumstances and applies the *glue* into its private `_preInstructions`-list, which gets glued in front of the instructions, that the template itself generates.

The templates can be found in `instructionGeneration/**/*.ts` and respective helper sub-folders.
Addition and subtraction is a bit of a special snow flake, because there are just so many different contexts and operand combinations, that we created special templates for each situation (`instructionGeneration/{addition,subtration}helpers`). 
E.g. File `instructionGeneration/additionhelpers/fr__rm_rm_rmf.ts` offers templates where the output is carry-flag out + register out (`fr__` of the filename), provided there are three operands (`x_x_x` of the filename), op1 and op2 in either register or memory (`rm_rm`), and op3 can additionally be in a flag (`rmf`).

## Mutations and Bias

The mutations are handled in `model/model.class.ts`, which relies on `paul/Paul.class.ts` as the oracle.

### Permutation mutations (P-Mutation)

The method `Model:mutatePermutation` does:

1. Pick an index from the `_nodes` list
1. Resolve the node (i.e. operation) behind it
1. Calculate the interval or relative movements
1. Ask `Paul` to pick a number with *REVERSE_BELL*-shaped bias, from that interval
1. Splice the index into the new position.

### Decision mutations (D-Mutation)

The decisions are attached to the operations themselves.
They are assigned randomly during startup (while calling `helper/fiat-helpers.ts:preprocessFunction`, in particular in line 50, `addDecisionProperty`).

The method `Model:mutateDecision` does:

1. Find the nodes, where decisions are *hot* (A decision is hot, if it has been read in the last assemble-run. i.e. In the context of an operation, the optimizer actually read a decision off the operation. We don't always read the decision. E.g. Say the context *is `OF` has a value, `CF` dead* and the operation is an addition. The, we don't check the decision (which may be 'use OF'). Rather, we see that we can just use CF. Then, this decision stays *cold*. And thus it does not make sense to mutate that decision, because it would not change the assembly output.)
1. Check this decision-property and choose an alternative. Often, there is only one alternative (e.g. use `CF` over `OF`). In the case that there is multiple, we choose unbiased randomly.

