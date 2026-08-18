import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface ConfirmSubscriptionEmailProps {
  confirmUrl: string;
}

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

const container = {
  margin: "0 auto",
  maxWidth: "600px",
  padding: "24px 0 48px",
};

const card = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  marginBottom: "20px",
  padding: "24px",
};

const heading = {
  color: "#111111",
  fontSize: "24px",
  fontWeight: "700",
  margin: "0 0 16px",
};

const paragraph = {
  color: "#333333",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const button = {
  backgroundColor: "#3b4df3",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: "600",
  padding: "12px 20px",
  textDecoration: "none",
};

const fallback = {
  color: "#666666",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "16px 0 0",
  wordBreak: "break-all" as const,
};

const footer = {
  color: "#9ca3af",
  fontSize: "12px",
  lineHeight: "1.6",
  textAlign: "center" as const,
};

export const ConfirmSubscriptionEmail = ({ confirmUrl }: ConfirmSubscriptionEmailProps) => (
  <Html lang="en">
    <Head />
    <Preview>Confirm your place on the Iconsmith launch list</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={card}>
          <Heading style={heading}>One click to confirm</Heading>

          <Text style={paragraph}>
            Someone entered this address to hear when Iconsmith ships. If that was you, confirm
            below and you are on the list.
          </Text>

          <Button href={confirmUrl} style={button}>
            Confirm my address
          </Button>

          <Text style={fallback}>
            Or paste this into your browser: <Link href={confirmUrl}>{confirmUrl}</Link>
          </Text>

          <Text style={paragraph}>
            If it was not you, ignore this email. Nothing is stored and you will not hear from me
            again. The link expires in 24 hours.
          </Text>
        </Section>

        <Text style={footer}>
          Matthew Blode, Melbourne, Australia
          <br />
          You received this because this address was entered at blode.co/iconsmith. You are not
          subscribed unless you confirm.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default ConfirmSubscriptionEmail;
