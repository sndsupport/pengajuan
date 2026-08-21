"use client";

import { useEffect } from "react";
import { connectToEmulatorsIfConfigured } from "@/lib/firebase/client";

export function EmulatorBootstrap() {
  useEffect(() => {
    connectToEmulatorsIfConfigured();
  }, []);
  return null;
}
