# POSN Camp 2 Missing Problem Assets Design

## Goal

Prepare reusable, reviewable assets for every non-TOI PDF problem from `rbunpat/posn-camp2` that is absent from the current Grader OJ problem catalog. The working scope is 107 problems, based on the comparison already made in this conversation. Nothing is imported into or published on the running OJ as part of this work.

## Deliverables

Create one directory per problem under a dedicated generated-assets directory in this workspace. Each directory contains:

- `config.json`
- the source statement PDF
- `solution.cpp` as a reference solution
- `testcases.zip` with exactly 10 input/output pairs

Provide a combined outer ZIP with the problem directories in the batch-import structure documented in `README.md`. Keep the reference `solution.cpp` alongside each problem as a supplemental file; the OJ importer uses the config, PDF, and testcases to create OJ records and does not publish the solution source.

## Problem inventory and source

Use PDFs in the `pdf/` directory of <https://github.com/rbunpat/posn-camp2>. Exclude every filename beginning with `TOI`, case-insensitively. For the rest, use the set previously identified as absent by comparison with the running Grader OJ database. Recheck IDs against the catalog before packaging so problems added since the comparison are not duplicated.

## Config generation

For each problem, inspect the statement and compare nearby problems in the Grader OJ catalog. Use those comparable records as the primary pattern for `id`, display title, author, time limit, memory limit, categories, difficulty, and collection. Keep IDs stable, valid, and unique. Do not blindly assign a generic author or limits across the entire batch. Omit optional metadata when the comparable OJ patterns do not support a defensible value; preserve the importer's documented semantics for omitted fields.

## Solutions and test cases

Read each PDF for the exact input/output format, constraints, and required behavior. Use a matching reference implementation from the source repository when it demonstrably solves that statement; otherwise write a C++17 solution. Build 10 valid, distinct cases per problem, with coverage guided by the statement's constraints and edge conditions. Generate each expected output from the reference solution and independently inspect the cases and outputs for format and boundary errors.

## Packaging and quality checks

Before producing the outer ZIP, verify that every scoped problem has one config, one statement PDF, one C++ solution, and exactly 10 paired test cases; all IDs are unique; all inner ZIPs have valid pairings; the outer directory layout follows the documented batch importer format; and the package contains no TOI problems. Compile and run each solution against its generated cases as the required way to produce/check expected outputs. Record any problem whose statement is incomplete or ambiguous rather than inventing unsupported behavior.

## Out of scope

- Importing or publishing the generated problems into the live Grader OJ.
- Editing the source `posn-camp2` repository.
- Generating assets for TOI PDFs or problems already present in Grader OJ.
- Claiming that an inferred solution or metadata is authoritative when the source statement does not establish it.
