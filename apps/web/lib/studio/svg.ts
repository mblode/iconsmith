export const safeStudioSvg = (svg: string): string => {
  if (!svg.includes("<svg") || /<script/iu.test(svg)) {
    return "";
  }
  return svg.replaceAll("<title", "<!--").replaceAll("</title>", "-->");
};
