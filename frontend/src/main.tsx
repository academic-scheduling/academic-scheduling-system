import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./index.css";
import { AuthProvider } from "./auth/AuthContext";
import { I18nProvider } from "./i18n";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* defaultColorScheme="auto": ilk açılışta işletim sistemini izler; kullanıcı
        header'daki düğmeyle değiştirince seçim localStorage'da kalıcı olur. */}
    <MantineProvider defaultColorScheme="auto">
      <Notifications />
      {/* K-79: dil bağlamı AuthProvider'ın DIŞINDA — giriş ekranı ve oturum
          hatası bildirimleri de çevrilebilsin diye (onlar auth'tan önce görünür). */}
      <I18nProvider>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </MantineProvider>
  </React.StrictMode>
);