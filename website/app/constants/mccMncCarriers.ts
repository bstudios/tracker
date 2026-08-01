/**
 * Friendly names for the UK mobile networks (MCC 234/235) most likely to show up in tracker
 * data. Not an exhaustive world MCC-MNC database — just enough to label the common carriers;
 * anything else falls back to the raw "MCC-MNC" code.
 */
const CARRIER_NAMES: Record<string, string> = {
  "234-00": "BT",
  "234-02": "O2",
  "234-10": "O2",
  "234-11": "O2",
  "234-15": "Vodafone",
  "234-16": "TalkTalk",
  "234-20": "Three",
  "234-26": "Lycamobile",
  "234-30": "EE",
  "234-31": "EE",
  "234-32": "EE",
  "234-33": "EE",
  "234-34": "EE",
  "234-38": "Virgin Mobile",
  "234-54": "iD Mobile",
  "234-57": "Sky Mobile",
  "234-76": "BT",
  "234-77": "Vodafone",
  "234-86": "EE",
  "234-87": "Lebara",
  "235-01": "EE",
  "235-02": "EE",
  "235-77": "BT",
  "235-91": "Vodafone",
  "235-94": "Three",
};

const normalizeMnc = (mnc: string | number) => String(mnc).padStart(2, "0");

export const formatMccMnc = (mcc: string | number, mnc: string | number) =>
  `${mcc}-${normalizeMnc(mnc)}`;

export const getCarrierName = (mcc: string | number, mnc: string | number) =>
  CARRIER_NAMES[formatMccMnc(mcc, mnc)] ?? formatMccMnc(mcc, mnc);
