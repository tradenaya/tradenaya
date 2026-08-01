import { NextRequest, NextResponse } from "next/server";

export function middleware(
  request: NextRequest
) {
  const adminToken =
    request.cookies.get(
      "tradiaura_admin_token"
    )?.value;

  const customerToken =
    request.cookies.get(
      "tradiaura_user_token"
    )?.value;

  const pathname =
    request.nextUrl.pathname;

  /*
  =====================
  ADMIN PROTECTION
  =====================
  */

  if (
    pathname.startsWith("/admin")
  ) {

    // Allow admin login page
    if (
      pathname ===
      "/admin-signin"
    ) {

      // Already logged in
      if (adminToken) {
        return NextResponse.redirect(
          new URL(
            "/admin/dashboard",
            request.url
          )
        );
      }

      return NextResponse.next();
    }

    // Not logged in
    if (!adminToken) {
      return NextResponse.redirect(
        new URL(
          "/admin-signin",
          request.url
        )
      );
    }
  }

  /*
  =====================
  CUSTOMER PROTECTION
  =====================
  */

  if (
    pathname === "/signin"
  ) {
    if (customerToken) {
      return NextResponse.redirect(
        new URL(
          "/dashboard",
          request.url
        )
      );
    }
  }

  if (
    pathname === "/signup"
  ) {
    if (customerToken) {
      return NextResponse.redirect(
        new URL(
          "/dashboard",
          request.url
        )
      );
    }
  }

  // if (
  //   pathname.startsWith(
  //     "/dashboard"
  //   )
  // ) {
  //   if (!customerToken) {
  //     return NextResponse.redirect(
  //       new URL(
  //         "/signin",
  //         request.url
  //       )
  //     );
  //   }
  // }

  if (
  pathname.startsWith("/dashboard") &&
  pathname !== "/dashboard"
) {
  if (!customerToken) {
    return NextResponse.redirect(
      new URL("/signin", request.url)
    );
  }
}

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/admin-signin",
    "/dashboard/:path*",
    "/signin",
    "/signup",
  ],
};

