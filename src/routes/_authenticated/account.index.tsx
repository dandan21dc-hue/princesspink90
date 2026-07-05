import { createFileRoute } from "@tanstack/react-router";
import { AccountIndex } from "./account";

export const Route = createFileRoute("/_authenticated/account/")({
  component: AccountIndex,
});
