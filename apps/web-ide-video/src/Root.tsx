import { Composition } from 'remotion';
import {
  AuthStrategyExplainer,
  type AuthStrategyExplainerProps,
} from './AuthStrategyExplainer';
import {
  AuthStrategyWithImages,
  type AuthStrategyWithImagesProps,
} from './AuthStrategyWithImages';

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="AuthStrategyExplainer"
        component={AuthStrategyExplainer}
        durationInFrames={480}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={
          {
            headline: 'Auth strategy',
            subheadline: 'Passkeys, trust tiers, and tailnet-executed credential use.',
            siteUrl: 'almostnode.dev',
          } satisfies AuthStrategyExplainerProps
        }
      />
      <Composition
        id="AuthStrategyWithImages"
        component={AuthStrategyWithImages}
        durationInFrames={5100}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={
          {
            headline: 'Auth strategy',
            siteUrl: 'almostnode.dev',
            paceMultiplier: 10,
          } satisfies AuthStrategyWithImagesProps
        }
      />
    </>
  );
};
