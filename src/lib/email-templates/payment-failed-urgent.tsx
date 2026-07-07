import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Text,
} from "@react-email/components";

interface Props {
  siteName: string;
  siteUrl: string;
  billingUrl: string;
  attemptedAmount?: string;
}

export const PaymentFailedUrgentEmail = ({
  siteName, siteUrl, billingUrl, attemptedAmount,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Still couldn't charge your card — please update it to avoid losing access.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Second attempt on your card failed</Heading>
        <Text style={text}>
          We tried again to renew your <Link href={siteUrl} style={link}><strong>{siteName}</strong></Link>{" "}
          subscription for {attemptedAmount ?? "the usual amount"} and it was declined
          a second time.
        </Text>
        <Text style={text}>
          You still have access, but if we can't take payment in the next week,
          your subscription will end and your access will be cut off.
        </Text>
        <Button style={button} href={billingUrl}>Update payment method now</Button>
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
