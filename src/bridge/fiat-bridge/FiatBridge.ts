/**
 * Copyright 2022 University of Adelaide
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { execSync } from "child_process";
import { accessSync, chmodSync, constants as FS_CONSTANTS, existsSync, readFileSync } from "fs";
import { ensureDirSync } from "fs-extra";
import { resolve } from "path";

import { datadir, env, preprocessFunction } from "@/helper";
import { sha256Hash } from "@/paul";
import type { CryptOpt, Fiat } from "@/types";

import { Bridge } from "../bridge.interface";
import {
  AVAILABLE_CURVES,
  AVAILABLE_METHODS,
  CURVE_DETAILS,
  CURVE_T,
  METHOD_DETAILS,
  METHOD_T,
  SHA256SUMS,
} from "./constants";
import { BINS } from "./enums";

const cwd = resolve(datadir, "fiat-bridge");

const { CC, CFLAGS } = env;
const cacheDir = resolve(cwd, ".cache");

export class FiatBridge implements Bridge {
  public argnumin(m: METHOD_T): number {
    if (!AVAILABLE_METHODS.includes(m)) {
      throw new Error(`unsupported method ${m}`);
    }
    if (m === "square") return 1;
    // add, sub, mul
    return 2;
  }

  public argnumout(_m: METHOD_T): number {
    return 1;
  }

  public argwidth(c: CURVE_T): number {
    if (c in CURVE_DETAILS) return CURVE_DETAILS[c].argwidth;
    throw new Error(`unsupported curve ${c}`);
  }

  public static bounds(c: CURVE_T): string[] {
    return CURVE_DETAILS[c].bounds;
  }

  /**
   * calls ./unsaturated_solinas or ./word_by_word_montgomery,
   * obtains the JSON code and returns the parsed string of the specified @param method on @param curve
   */
  public getCryptOptFunction(method: METHOD_T, curve: CURVE_T): CryptOpt.Function {
    if (!existsSync(cacheDir)) {
      ensureDirSync(cacheDir);
    }
    // we want to make sure, that the filename is dependent on the hash of the binary creating it, and on the arguments passed to it.

    const { cmd, hash } = this.buildCommand(curve, method, "JSON");
    const jsonCacheFilename = resolve(cacheDir, `${hash}.json`);

    let fiatBuffer: Buffer;
    if (existsSync(jsonCacheFilename)) {
      console.log(`reading json-fiat: ${jsonCacheFilename}`);
      fiatBuffer = readFileSync(jsonCacheFilename);
    } else {
      const command = `${cmd} | jq -s .[0] | tee ${jsonCacheFilename}`;
      console.log(`executing cmd to generate fiat: ${command}`);
      fiatBuffer = execSync(command);
    }

    const fiat = JSON.parse(fiatBuffer.toString()) as Fiat.FiatFunction;
    const cryptOpt = preprocessFunction(fiat);
    return cryptOpt;
  }

  /**
   * calls the ./unsaturated_solinas or ./word_by_word_montgomery with @param curve @param method to get the C code, and compiles the c code to an so
   * @returns the name of the symbol, which is being present in @param filename after this function is finished.
   * if force is false, it will check if the machinecode needs to be generated, and skip the step if its not necessary
   */
  public machinecode(
    filename: string,
    method: METHOD_T,
    curve: CURVE_T,
    ccOverwrite: string | undefined = undefined,
    force = true,
  ): string {
    const { cmd, methodname, hash } = this.buildCommand(curve, method, "C");
    if (!force && existsSync(filename)) {
      return methodname;
    }

    const cc = ccOverwrite ?? CC; // this is being used for the x-val, where in one session of the FiatBridge, the CC chagnes

    const compileFromFile = (file: string) => {
      const command = `${cc} ${CFLAGS} -fPIC -shared -o ${filename} ${file}`;
      console.log(`executing cmd to generate machinecode: ${command}`);
      execSync(command);
      return methodname;
    };

    // lets check cached.
    if (!existsSync(cacheDir)) {
      ensureDirSync(cacheDir);
    }

    const cCacheFilename = resolve(cacheDir, `${hash}.c`);

    // if the cache-file does not exist, write it.
    if (!existsSync(cCacheFilename)) {
      const command = `${cmd} > ${cCacheFilename}`;
      console.log(`executing cmd to generate c-file: ${command}`);
      execSync(command);
    }

    // then we can compile from it.
    return compileFromFile(cCacheFilename);
  }

  /**
   * this is a helper function which looks up the parameters for @param method on curve @param curve.
   * It also validated, if the generation binaries are present (./word_by_word_montgomery or ./unsaturated_solinas), depending on the curve.
   * It @returns a string to be executed in the current dir and the method it has created (like mul or carry_mul).
   */
  public buildCommand(
    curve: CURVE_T,
    method: METHOD_T,
    lang: "C" | "JSON",
  ): { cmd: string; methodname: string; hash: string } {
    const { binary, prime, bitwidth, argwidth } = CURVE_DETAILS[curve];

    const binWithPath = resolve(cwd, binary);
    FiatBridge.check(curve, method, binWithPath, lang);

    const required_function = METHOD_DETAILS[method].name[binary]; // e.g carry_mul
    const methodname = `fiat_${curve}_${required_function}`;

    // independent of implementation strategy
    const CODE_GENERATION_ARGS = {
      // JSON: "--no-primitives --no-wide-int",
      JSON: "--no-primitives --emit-all-casts",
      C: " --inline-internal --internal-static --use-value-barrier",
      // C: " --inline-internal --internal-static --use-value-barrier --no-primitives --no-wide-int ",
    };

    // represents the identity of the fiat binaries.
    const sha256sumsFile = resolve(cwd, SHA256SUMS);
    const hashFiatBinaries = readFileSync(sha256sumsFile).toString();

    let cmd = "";
    if (binary == BINS.unsaturated) {
      cmd = `${binWithPath} --lang ${lang} ${CODE_GENERATION_ARGS[lang]} '${curve}' '${bitwidth}' '${argwidth}' '${prime}' ${required_function}`;
    } else {
      cmd = `${binWithPath} --lang ${lang} ${CODE_GENERATION_ARGS[lang]} '${curve}' '${bitwidth}'               '${prime}' ${required_function}`;
    }

    // now generate the hash
    const hash = sha256Hash(`${cmd} ${hashFiatBinaries}`);
    return { cmd, methodname, hash };
  }
  /**
   * creates string to execute for proof.
   * Depending on curve, it'll invoke unsaturated_solinas or word_by_word_montgomery with resp. arguments
   */

  public static buildProofCommand(curve: CURVE_T, method: METHOD_T, hintsFilename: string): string {
    const { binary, prime, bitwidth, argwidth } = CURVE_DETAILS[curve];
    const binWithPath = resolve(cwd, binary);

    FiatBridge.check(curve, method, binWithPath);

    const required_function = METHOD_DETAILS[method].name[binary]; // e.g carry_mul

    let CODE_PROOF_ARGS = [
      "--no-primitives",
      "--no-wide-int",
      "--shiftr-avoid-uint1",
      "--output /dev/null",
      "--output-asm /dev/null",
    ].join(" ");

    const hintstring = `--hints-file ${hintsFilename}`;

    switch (binary) {
      case BINS.unsaturated:
        CODE_PROOF_ARGS += ` --tight-bounds-mul-by 1.000001`;
        return `${binWithPath}  ${CODE_PROOF_ARGS} '${curve}' '${bitwidth}' '${argwidth}' '${prime}' ${required_function} ${hintstring}`;
      case BINS.wbw_montgomery:
        return `${binWithPath}  ${CODE_PROOF_ARGS} '${curve}' '${bitwidth}'               '${prime}' ${required_function} ${hintstring}`;
    }
  }

  /**
   * checks if file @param binary is present
   * checks if @param method is supported
   * checks if @param curve is supported
   * checks if @param lang is supported
   * @throws if any check fails.
   */
  private static check(curve: CURVE_T, method: METHOD_T, binary: string, lang?: string): void {
    if (!AVAILABLE_METHODS.includes(method)) {
      throw new Error(`Invalid method. Arg ${method} is not in ${AVAILABLE_METHODS}.`);
    }

    if (!AVAILABLE_CURVES.includes(curve)) {
      throw new Error(`Invalid curve. Arg ${curve} is not in ${AVAILABLE_CURVES}.`);
    }

    if (lang && !["C", "JSON"].includes(lang)) {
      throw new Error(`Unsupported lang "${lang}"`);
    }

    if (!existsSync(binary)) {
      throw new Error(`${binary} does not exist. Cannot create ${lang} code.`);
    }

    const requiredPermissions = FS_CONSTANTS.F_OK | FS_CONSTANTS.R_OK | FS_CONSTANTS.X_OK | FS_CONSTANTS.W_OK;
    try {
      accessSync(binary, requiredPermissions);
      // here it exists with correct permissons
    } catch (e) {
      // here it exists with INCORRECT permissons
      try {
        chmodSync(binary, requiredPermissions);
        // here it exists with correct permissons
      } catch (e) {
        // here it exists with INCORRECT permissons, cause they couldn't be set. Fatal here.
        const permOct = `0${requiredPermissions.toString(8)}`;
        throw new Error(
          `${binary} does exist, but does not have the correct permissions (${permOct}). Cannot change permissions either - this is an error code.`,
        );
      }
    }
  }
}
