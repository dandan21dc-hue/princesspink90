import * as React from "react";
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Text,
} from "@react-email/components";

interface Props {
  siteName: string;
  siteUrl: string;
  billingUrl: string;
}

export const PaymentFailedFinalEmail = ({ siteName, siteUrl, billingUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Final notice — your subscription is about to end.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Final notice — access ending soon</Heading>
        <Text style={text}>
          This is our final attempt to reach you about your{" "}
          <Link href={siteUrl} style={link}><strong>{siteName}</strong></Link>{" "}
          subscription. We haven't been able to charge your card for the
          past two weeks.
        </Text>
        <Text style={text}>
          Unless the payment goes through in the next 24-48 hours, your
          subscription will be canceled and your library access will end.
        </Text>
        <Button style={button} href={billingUrl}>Update card &amp; keep access</Button>
        <Text style={smallMuted}>
          Prefer to cancel? No need to reply — Stripe will end the subscription
          on its own after this final retry.
        </Text>
      </Container>
    </Body>
  </Html>
);

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "24px 28px", maxWidth: "560px" };
const h1 = { fontSize: "22px", fontWeight: 700 as const, margin: "0 0 16px" };
const text = { fontSize: "14px", lineHeight: "22px", color: "#1f2937", margin: "0 0 14px" };
const link = { color: "#e11d5c" };
const button = {
  backgroundColor: "#e11d5c",
  color: "#ffffff",
  padding: "12px 18px",
  borderRadius: "6px",
  textDecoration: "none",
  fontWeight: 600 as const,
  fontSize: "14px",
  display: "inline-block",
  margin: "8px 0 20px",
};
const smallMuted = { fontSize: "12px", color: "#6b7280", margin: "0" };
