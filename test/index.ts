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

import type { SpyInstance } from "vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Optimizer } from "@/optimizer";

const args: {
  evals: number;
  seed: number;
  curve: string;
  method: string;
  cyclegoal: number;
  readState?: string; // filename
  logComment: string;
  proof: boolean;
  verbose: boolean;
  bridge?: string;
} = {
  evals: 1,
  seed: 1,
  curve: "",
  method: "",
  cyclegoal: 100,
  logComment: "",
  verbose: false,
  proof: false,
};

describe("full tests fiat", () => {
  let mockLog: SpyInstance;
  let mockErr: SpyInstance;
  beforeAll(() => {
    const dofkall = (_msg: string) => {
      /*intentionally empty*/
    };
    mockLog = vi.spyOn(console, "log").mockImplementation(dofkall);
    mockErr = vi.spyOn(console, "error").mockImplementation(dofkall);
  });
  afterAll(() => {
    mockLog.mockRestore();
    mockErr.mockRestore();
  });
  it("shoud error", () => {
    expect(() => {
      throw new Error("n");
    }).toThrow();
  });

  it("should only throw on invalid curves.", () => {
    expect(() => {
      new Optimizer(Object.assign({}, args, { curve: "curve25519", method: "square" }));
    }).not.toThrow();

    expect(() => {
      new Optimizer(Object.assign({}, args, { curve: "INVALIDCURVE", method: "square" }));
    }).toThrow(/Cannot destructure property 'binary' of '.*' as it is undefined./);
  });

  afterAll(() => {
    vi.useRealTimers();
  });
});
