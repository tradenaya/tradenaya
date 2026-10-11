"use client";

import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { store, persistor } from "@/store/store";

import AdminThemeProvider
  from "@/components/providers/AdminThemeProvider";
import CustomerThemeProvider
  from "@/components/providers/CustomerThemeProvider";
import CurrencyProvider
  from "@/lib/currency/CurrencyProvider";
import TradingModeProvider
  from "@/lib/trading-mode/TradingModeProvider";
import AuthHydrator
  from "@/components/auth/AuthHydrator";

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <AuthHydrator>
          <AdminThemeProvider>
            <CustomerThemeProvider>
              <TradingModeProvider>
                <CurrencyProvider>
                  {children}
                </CurrencyProvider>
              </TradingModeProvider>
            </CustomerThemeProvider>
          </AdminThemeProvider>
        </AuthHydrator>
      </PersistGate>
    </Provider>
  );
}
