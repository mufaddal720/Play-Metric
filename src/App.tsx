import { useRoute } from './lib/router';
import { useDocumentDirection } from './i18n';
import { Layout } from './ui/Layout';
import { Home } from './screens/Home';
import { HowToPlay } from './screens/HowToPlay';
import { Setup } from './screens/Setup';
import { MatchScreen } from './screens/MatchScreen';
import { Results } from './screens/Results';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
import { Privacy } from './screens/Privacy';
import type { GameId } from './core/types';

export default function App() {
  useDocumentDirection();
  const [page, arg] = useRoute();
  let content;
  switch (page) {
    case 'how': content = <HowToPlay />; break;
    case 'setup': content = <Setup key={arg} initialGame={(arg as GameId) ?? 'freeze'} />; break;
    case 'match': content = <MatchScreen key={arg} id={arg} />; break;
    case 'results': content = <Results id={arg} />; break;
    case 'history': content = <History />; break;
    case 'settings': content = <Settings />; break;
    case 'privacy': content = <Privacy />; break;
    default: content = <Home />;
  }
  return <Layout wide={page === 'match'}>{content}</Layout>;
}
