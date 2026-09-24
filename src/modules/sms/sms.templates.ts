/**
 * SMS Templates for OTP messages
 */

export const signupOtpSmsTemplate = (code: string): string => {
    return `Your Carpooling signup OTP is: ${code}. Valid for 5 minutes. Do not share this code.`;
};

export const loginOtpSmsTemplate = (code: string): string => {
    return `Your Carpooling login OTP is: ${code}. Valid for 5 minutes. Do not share this code.`;
};

export const resetOtpSmsTemplate = (code: string): string => {
    return `Your Carpooling password reset OTP is: ${code}. Valid for 5 minutes. Do not share this code.`;
};

export const contactVerifyOtpSmsTemplate = (code: string): string => {
    return `Your Carpooling phone verification OTP is: ${code}. Valid for 5 minutes. Do not share this code.`;
};
