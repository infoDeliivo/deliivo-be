// Release flags are opt-in in every environment, including staging.
export const rewardsEnabled = () => process.env.REWARDS_ENABLED === 'true';

export function assertRewardsEnabled() {
  if (!rewardsEnabled()) throw new Error('REWARDS_DISABLED');
}
