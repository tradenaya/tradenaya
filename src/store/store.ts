import { combineReducers, configureStore } from "@reduxjs/toolkit";

import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from "redux-persist";

import storage from "redux-persist/lib/storage";

import adminAuthReducer from "./slices/adminAuthSlice";
import customerAuthReducer from "./slices/customerAuthSlice";
import adminThemeReducer from "./slices/adminThemeSlice";
import customerThemeReducer from "./slices/customerThemeSlice";
import tenantReducer from "./slices/tenantSlice";

const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

const persistConfig = {
  key: "tradenaya-v1",
  storage:
    typeof window === "undefined"
      ? noopStorage
      : storage,
  whitelist: [
    "customerAuth",
    "tenant",
  ],
};

const rootReducer = combineReducers({
  adminAuth: adminAuthReducer,
  customerAuth: customerAuthReducer,
  adminTheme: adminThemeReducer,
  customerTheme: customerThemeReducer,
  tenant: tenantReducer,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
