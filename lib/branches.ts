export const BRANCHES = [
  "WHO Bandung",
  "WHO Bogor",
  "WHO Cibaduyut",
  "WHO Cirebon",
  "WHO Garut",
  "WHO Karawang",
  "WHO Purwakarta",
  "WHO Serang",
  "WHO Sukabumi",
  "WHO Tangerang",
  "WHO Tasikmalaya",
  "WHP Bandung",
  "WHP Tasikmalaya",
  "HO-O Bandung",
  "HO Tasikmalaya",
  "SND",
] as const;

export type Branch = (typeof BRANCHES)[number];
