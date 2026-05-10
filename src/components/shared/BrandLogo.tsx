import Image from "next/image";
import { BUSINESS_LOGO_PATH, BUSINESS_NAME } from "@/lib/business";

type BrandLogoProps = {
  showName?: boolean;
  size?: "nav" | "footer";
  priority?: boolean;
};

const LOGO_DIMENSIONS = {
  nav: 72,
  footer: 56
} as const;

export default function BrandLogo({ showName = false, size = "nav", priority = false }: BrandLogoProps) {
  const dimension = LOGO_DIMENSIONS[size];

  return (
    <span className={`brand-logo ${showName ? "brand-logo-with-name" : ""}`}>
      <span className={`brand-mark brand-mark-${size}`} aria-hidden="true">
        <Image src={BUSINESS_LOGO_PATH} alt="" width={dimension} height={dimension} priority={priority} />
      </span>
      {showName ? <span className="brand-wordmark">{BUSINESS_NAME}</span> : <span className="sr-only">{BUSINESS_NAME}</span>}
    </span>
  );
}
