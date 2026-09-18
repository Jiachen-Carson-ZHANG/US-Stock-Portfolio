"use client";

import { createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import {
  LOCALE_COOKIE,
  getDictionary,
  type Dictionary,
  type Locale,
} from "./dictionaries";

type LocaleValue = { locale: Locale; t: Dictionary };

const LocaleContext = createContext<LocaleValue>({
  locale: "en",
  t: getDictionary("en"),
});

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <LocaleContext.Provider value={{ locale, t: getDictionary(locale) }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useT(): Dictionary {
  return useContext(LocaleContext).t;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

/**
 * Language is a display preference, so it lives in a plain cookie the server
 * can read while rendering — no round trip and no flash of the wrong language.
 */
export function useSetLocale() {
  const router = useRouter();

  return (locale: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  };
}
