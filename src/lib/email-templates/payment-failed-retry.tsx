import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Text,
} from "@react-email/components";

interface Props {
  siteName: string;
  siteUrl: string;
  billingUrl: string;
  attemptedAmount?: string; // pre-formatted, e.g. "A$10.00"
}

export const PaymentFailedRetryEmail = ({
  siteName, siteUrl, billingUrl, attemptedAmount,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your last payment didn't go through — update your card to keep access.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your payment needs your attention</Heading>
        <Text style={text}>
          Hi — a heads up that our attempt to charge {attemptedAmount ?? "your card"} for
          your subscription to <Link href={siteUrl} style={link}><strong>{siteName}</strong></Link>{" "}
          didn't go through.
        </Text>
        <Text style={text}>
          Your access is still active for now — we'll keep retrying automatically for
          the next couple of weeks. If your card details have changed, updating them now
          is the fastest fix.
        </Text>
        <Button style={button} href={billingUrl}>Update payment method</Button>
        <Text style={smallMuted}>
          If you meant to cancel, you can do that from the same page.
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
