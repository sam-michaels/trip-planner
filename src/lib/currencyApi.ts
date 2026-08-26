// ============================================================
// Country -> the currency you'll pay in there.
//
// THIS USED TO BE A NETWORK CALL, and the reasoning was sound at the
// time: a live lookup can't go stale, and this app assumes good wifi
// because it's for planning, not for carrying around. That reasoning
// died on contact with the provider.
//
// REST Countries v3.1 was deprecated in 2026, and every remaining
// endpoint — v3.1 and v5 alike — now 301s to a static file host that
// sends no `Access-Control-Allow-Origin` header. That makes it
// unusable from a browser at any URL: the redirect itself fails CORS
// before the response is ever read. There is no drop-in replacement
// that is free, keyless, and CORS-enabled.
//
// So the table is vendored. The staleness risk that argued against it
// is real but small and slow — a country changing currency is a
// once-every-few-years event that makes the news, and the cost of
// being wrong here is a pre-filled dropdown showing the wrong default,
// which is one click to correct.
//
// NOT EXHAUSTIVE, and deliberately honest about it: unknown countries
// return `undefined` and the caller falls back to the home currency,
// which is exactly what happened when the network call failed anyway.
//
// Live FX *rates* are a different question and still come over the
// network — see `lib/currency.ts`.
// ============================================================

import type { CurrencyCode } from "../model/trip";

/**
 * ISO 3166-1 alpha-2 -> ISO 4217, as "CC:CUR" pairs.
 *
 * Flat pairs rather than currency-keyed groups because the lookup
 * direction is country -> currency, and a reader checking one country
 * shouldn't have to scan for it inside a block of thirty others.
 */
const COUNTRY_CURRENCY_PAIRS = `
AD:EUR AE:AED AF:AFN AG:XCD AI:XCD AL:ALL AM:AMD AO:AOA AR:ARS AS:USD
AT:EUR AU:AUD AW:AWG AX:EUR AZ:AZN BA:BAM BB:BBD BD:BDT BE:EUR BF:XOF
BG:BGN BH:BHD BI:BIF BJ:XOF BL:EUR BM:BMD BN:BND BO:BOB BQ:USD BR:BRL
BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD CA:CAD CD:CDF CF:XAF CG:XAF CH:CHF
CI:XOF CK:NZD CL:CLP CM:XAF CN:CNY CO:COP CR:CRC CU:CUP CV:CVE CW:ANG
CY:EUR CZ:CZK DE:EUR DJ:DJF DK:DKK DM:XCD DO:DOP DZ:DZD EC:USD EE:EUR
EG:EGP EH:MAD ER:ERN ES:EUR ET:ETB FI:EUR FJ:FJD FK:FKP FM:USD FO:DKK
FR:EUR GA:XAF GB:GBP GD:XCD GE:GEL GF:EUR GG:GBP GH:GHS GI:GIP GL:DKK
GM:GMD GN:GNF GP:EUR GQ:XAF GR:EUR GT:GTQ GU:USD GW:XOF GY:GYD HK:HKD
HN:HNL HR:EUR HT:HTG HU:HUF ID:IDR IE:EUR IL:ILS IM:GBP IN:INR IQ:IQD
IR:IRR IS:ISK IT:EUR JE:GBP JM:JMD JO:JOD JP:JPY KE:KES KG:KGS KH:KHR
KI:AUD KM:KMF KN:XCD KP:KPW KR:KRW KW:KWD KY:KYD KZ:KZT LA:LAK LB:LBP
LC:XCD LI:CHF LK:LKR LR:LRD LS:LSL LT:EUR LU:EUR LV:EUR LY:LYD MA:MAD
MC:EUR MD:MDL ME:EUR MF:EUR MG:MGA MH:USD MK:MKD ML:XOF MM:MMK MN:MNT
MO:MOP MP:USD MQ:EUR MR:MRU MS:XCD MT:EUR MU:MUR MV:MVR MW:MWK MX:MXN
MY:MYR MZ:MZN NA:NAD NC:XPF NE:XOF NF:AUD NG:NGN NI:NIO NL:EUR NO:NOK
NP:NPR NR:AUD NU:NZD NZ:NZD OM:OMR PA:PAB PE:PEN PF:XPF PG:PGK PH:PHP
PK:PKR PL:PLN PM:EUR PN:NZD PR:USD PS:ILS PT:EUR PW:USD PY:PYG QA:QAR
RE:EUR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK
SG:SGD SI:EUR SJ:NOK SK:EUR SL:SLE SM:EUR SN:XOF SO:SOS SR:SRD SS:SSP
ST:STN SV:USD SX:ANG SY:SYP SZ:SZL TC:USD TD:XAF TG:XOF TH:THB TJ:TJS
TK:NZD TL:USD TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TV:AUD TW:TWD TZ:TZS
UA:UAH UG:UGX US:USD UY:UYU UZ:UZS VA:EUR VC:XCD VE:VES VG:USD VI:USD
VN:VND VU:VUV WF:XPF WS:WST YE:YER YT:EUR ZA:ZAR ZM:ZMW ZW:ZWG
`;

const CURRENCY_BY_COUNTRY = new Map<string, CurrencyCode>(
  COUNTRY_CURRENCY_PAIRS.trim()
    .split(/\s+/)
    .map((pair) => pair.split(":") as [string, CurrencyCode]),
);

/**
 * Every ISO 4217 code the runtime recognises.
 *
 * This is the validation `CurrencyCode` gave up doing at the type
 * level — the type is a plain `string` because TypeScript can't
 * express "one of ~180 runtime-known values". Checking the vendored
 * table against it means a typo in the data above surfaces as a
 * missing default rather than as an `Intl` crash inside a formatter
 * three components away.
 */
const KNOWN_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

/**
 * The currency a country uses, or `undefined` if it isn't in the
 * table (or the table has a typo).
 *
 * Synchronous now that there's no network involved — callers that
 * used to await this can just read it.
 */
export function currencyForCountry(
  countryCode: string,
): CurrencyCode | undefined {
  const code = CURRENCY_BY_COUNTRY.get(countryCode.toUpperCase());
  return code && KNOWN_CURRENCIES.has(code) ? code : undefined;
}
