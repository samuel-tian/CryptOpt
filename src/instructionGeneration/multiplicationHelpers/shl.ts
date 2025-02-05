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

import { AllocationFlags, Flags, FlagState } from "@/enums";
import { isImm } from "@/helper";
import { RegisterAllocator } from "@/registerAllocator";
import type { asm, CryptOpt } from "@/types";

export function mul_imm_shl(c: CryptOpt.StringOperation): asm[] {
  const ra = RegisterAllocator.getInstance();
  ra.initNewInstruction(c);
  const imm = c.arguments[1];
  if (!isImm(imm)) {
    throw new Error("arg[1] must be an immediate value");
  }
  const hex = imm as CryptOpt.HexConstant;

  switch (hex) {
    case "0x2":
      return mul_x_shl(c, "0x1");
    case "0x4":
      return mul_x_shl(c, "0x2");
    case "0x8":
      return mul_x_shl(c, "0x3");
    case "0x10":
      return mul_x_shl(c, "0x4");
    default:
      throw new Error("unsupported immediate value");
  }
}
function mul_x_shl(c: CryptOpt.StringOperation, shiftCnt: CryptOpt.HexConstant): asm[] {
  const ra = RegisterAllocator.getInstance();
  ra.initNewInstruction(c);
  const factor = c.arguments[0];
  const allocation = ra.allocate({
    oReg: c.name,
    in: [factor],
    allocationFlags:
      AllocationFlags.DISALLOW_MEM |
      AllocationFlags.IN_0_AS_OUT_REGISTER |
      AllocationFlags.SAVE_FLAG_CF |
      AllocationFlags.SAVE_FLAG_OF,
  });

  const resR = allocation.oReg[0];

  ra.declareFlagState(Flags.CF, FlagState.KILLED);
  ra.declareFlagState(Flags.OF, FlagState.KILLED);
  return [
    ...ra.pres,
    `shl ${resR}, ${shiftCnt}; ${c.name[0]} <- ${factor} * ${c.arguments[1]}`,
    `;${ra.flagStateString()}`,
  ];
}
