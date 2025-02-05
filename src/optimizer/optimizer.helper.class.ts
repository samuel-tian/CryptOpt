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

import { Measuresuite } from "measuresuite";
import { resolve } from "path";

import { BRIDGES } from "@/bridge";
import {
  AVAILABLE_METHODS as AVAILABLE_BITCOIN_METHODS,
  BitcoinCoreBridge,
} from "@/bridge/bitcoin-core-bridge";
import {
  AVAILABLE_METHODS as AVAILABLE_FIAT_METHODS,
  CURVE_DETAILS,
  CURVE_T,
  FiatBridge,
  METHOD_T,
} from "@/bridge/fiat-bridge";
import { ManualBridge } from "@/bridge/manual-bridge";
import { Model } from "@/model";

const genLibcheckfunctionFullFilepath = (
  tmpDir: string,
  args: { seed: number; curve: string; method?: string },
) => {
  const suffix = `s${args.seed}-p${process.pid}-c${args.curve}${args.method ? "-m" : ""}${args.method ?? ""}`;
  return resolve(tmpDir, `libcheckfunctions-${suffix}.so`);
};

type neededArgs = {
  seed: number;
  curve: CURVE_T;
  method: METHOD_T;
  bridge?: typeof BRIDGES[number];
  jsonFile?: string;
  cFile?: string;
};
type ret = {
  argwidth: number;
  argnumin: number;
  argnumout: number;
  chunksize: number;
  bounds: string[];
  symbolname: string;
};

function initFiat(sharedObjectFilename: string, args: neededArgs): ret {
  const bridge = new FiatBridge();
  Model.init({
    curve: args.curve,
    json: bridge.getCryptOptFunction(args.method, args.curve),
  });

  const symbolname = bridge.machinecode(sharedObjectFilename, args.method, args.curve);
  const chunksize = 16; // only for reading the chunk breaks atm. see MS code
  const argwidth = bridge.argwidth(args.curve);
  const argnumin = bridge.argnumin(args.method);
  const argnumout = bridge.argnumout(args.method);

  const bounds = CURVE_DETAILS[args.curve].bounds;
  return { symbolname, chunksize, argwidth, argnumin, argnumout, bounds };
}

function initBitcoinCore(sharedObjectFilename: string, args: neededArgs): ret {
  const bridge = new BitcoinCoreBridge();
  Model.init({
    curve: args.curve,
    json: bridge.getCryptOptFunction(args.method),
  });

  const symbolname = bridge.machinecode(sharedObjectFilename, args.method);
  const chunksize = 16; // only for reading the chunk breaks atm. see MS code
  const argwidth = bridge.argwidth(args.curve, args.method);
  const argnumin = bridge.argnumin(args.method);
  const argnumout = bridge.argnumout(args.method);

  const bounds = bridge.bounds(args.curve, args.method);
  return { symbolname, chunksize, argwidth, argnumin, argnumout, bounds };
}

function initManual(sharedObjectFilename: string, args: neededArgs): ret {
  if (!args.jsonFile || !args.cFile) {
    throw new Error(
      "cannot use manual-brige w/o a bridgefile...  Where should I get my information from, huh?",
    );
  }
  const bridge = new ManualBridge(args.jsonFile, args.cFile);
  // manual
  Model.init({
    curve: "",
    json: bridge.getCryptOptFunction(),
  });
  const symbolname = bridge.machinecode(sharedObjectFilename);
  const chunksize = 16; // only for reading the chunk breaks atm. see MS code
  const argwidth = bridge.argwidth();
  const argnumin = bridge.argnumin();
  const argnumout = bridge.argnumout();
  //  bounds:    ["0x0000 3000 0000 0000",
  //  &            0x0000 1fff ffff ffff
  const bounds = ["0xffff ffff ffff ffff"]
    .concat(
      Array(argwidth - 1)
        //     0x0000 0fff ffff ffff
        //    "0x0000 1800 0000 0000"],
        .fill("0xffff ffff ffff ffff"),
    )
    .map((s) => s.replaceAll(" ", ""));

  const res = { symbolname, chunksize, argwidth, argnumin, argnumout, bounds };
  // console.info(res);
  return res;
}

function createMS(
  { argwidth, argnumin, argnumout, chunksize, bounds, symbolname }: ret,
  libcheckfunctionFile: string,
): Measuresuite {
  return new Measuresuite(argwidth, argnumin, argnumout, chunksize, bounds, libcheckfunctionFile, symbolname);
}

export function init(tmpDir: string, args: neededArgs): Measuresuite {
  const mapping: {
    [bridge: string]: {
      availableMethods: string[];
      generatorFunction: (soFile: string, args: neededArgs) => ret;
    };
  } = {
    fiat: { availableMethods: AVAILABLE_FIAT_METHODS, generatorFunction: initFiat },
    manual: { availableMethods: [], generatorFunction: initManual },
    "bitcoin-core": { availableMethods: AVAILABLE_BITCOIN_METHODS, generatorFunction: initBitcoinCore },
  };

  const sharedObjectFilename = genLibcheckfunctionFullFilepath(tmpDir, args);

  if (args.bridge) {
    if (!(args.bridge in mapping)) {
      throw new Error("Bridge is specified, but not valid.");
    }

    if (args.bridge === "manual") {
      const common = mapping[args.bridge].generatorFunction(sharedObjectFilename, args);
      return createMS(common, sharedObjectFilename);
    }

    const { generatorFunction: gen, availableMethods } = mapping[args.bridge];

    if (availableMethods.includes(args.method)) {
      const common = gen(sharedObjectFilename, args);
      return createMS(common, sharedObjectFilename);
    }
    throw new Error("Could not find  specified method in specified Bridge.");
  } else {
    const found = BRIDGES.find((bridge) => mapping[bridge].availableMethods.includes(args.method));
    if (found) {
      const common = mapping[found].generatorFunction(sharedObjectFilename, args);
      return createMS(common, sharedObjectFilename);
    } else {
      throw new Error("Could not find Bridge for specified method.");
    }
  }
}
