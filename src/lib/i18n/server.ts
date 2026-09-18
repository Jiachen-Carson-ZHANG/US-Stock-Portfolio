import "server-only";
import { cookies } from "next/headers";
import {
  LOCALE_COOKIE,
  getDictionary,
  isLocale,
  type Dictionary,
  type Locale,
} from "./dictionaries";

export async function currentLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : "en";
}

export async function serverDictionary(): Promise<{
  locale: Locale;
  t: Dictionary;
}> {
  const locale = await currentLocale();
  return { locale, t: getDictionary(locale) };
}
