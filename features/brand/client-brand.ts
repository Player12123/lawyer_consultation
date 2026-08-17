export type ClientBrand = {
  productName: string;
  assistantName: string;
  loginGreeting: string;
  loginPrompt: string;
  consultationGreeting: string;
  slogan: string;
  logoText: string;
  logoUrl?: string;
};

/**
 * Local default only. In production this object will be loaded before login
 * from the customer's deployment configuration or dedicated access address.
 */
export const clientBrand: ClientBrand = {
  productName: "12348 智能法律辅助平台",
  assistantName: "法律咨询助手",
  loginGreeting: "欢迎登录",
  loginPrompt: "请使用您的手机号登录",
  consultationGreeting: "您好，我是法律咨询助手",
  slogan: "让每一次法律咨询都有据可依",
  logoText: "法",
};
