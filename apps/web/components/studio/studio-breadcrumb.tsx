import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SITE_URL } from "@/lib/site-url";

const HOME = "https://blode.co";
const PROJECTS = `${HOME}/projects`;

export const StudioBreadcrumb = () => (
  <Breadcrumb aria-label="Breadcrumb">
    <BreadcrumbList>
      <BreadcrumbItem>
        <BreadcrumbLink href={HOME} rel="author">
          Matthew Blode
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem>
        <BreadcrumbLink href={PROJECTS}>Projects</BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem>
        <BreadcrumbLink href={SITE_URL}>Iconsmith</BreadcrumbLink>
      </BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>
);
