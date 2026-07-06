import * as React from "react";
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Text,
} from "@react-email/components";

interface Props {
  siteName: string;
  siteUrl: string;
  billingUrl: string;
}

export const TrialEndingEmail = ({ siteName, siteUrl, billingUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your free trial ends in 3 days.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your trial ends in 3 days</Heading>
        <Text style={text}>
          Just a heads up — your free trial with{" "}
          <Link href={siteUrl} style={link}><strong>{siteName}</strong></Link>{" "}
          ends in 3 days.
        </Text>
        <Text style={text}>
          If your card is on file, you'll be charged automatically and access
          continues without interruption. If you'd rather cancel, you can do
          it from the same page in one click.
        </Text>
        <Button style={button} href={billingUrl}>Review billing</Button>
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
