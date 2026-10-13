import { Link } from 'react-router-dom'
import { usePageTitle } from './usePageTitle'

// These two are set when the site is deployed (VITE_DATA_COUNTRY and VITE_CONTACT_EMAIL). Steam's terms require the
// policy to name the country where Steam data is stored, so until it is set the page says so plainly instead of guessing.
const DATA_COUNTRY = import.meta.env.VITE_DATA_COUNTRY?.trim()
const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL?.trim()

export default function PrivacyPage() {
  usePageTitle('Privacy and Steam data')

  return (
    <article className="policy">
      <h1>Privacy and Steam data</h1>
      <p className="policy-note">
        This page explains what BacklogVault does with your information, and in particular with your Steam data. It is
        written in plain language and is not legal advice.
      </p>

      <h2>When we use Steam</h2>
      <p>
        Connecting Steam is optional. When you click &quot;Sign in through Steam&quot;, you sign in on Steam&apos;s own
        website, and Steam tells us which Steam account you are. We never see or store your Steam password.
      </p>
      <p>
        After you connect, we read your Steam data <strong>only when you ask us to</strong>: when you press Import, when
        you press Refresh from Steam, and when you open your dashboard (which shows what you played in the last two
        weeks). We never read the Steam data of anyone who has not connected their own account.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your Steam ID (the number that identifies your account) and your Steam display name.</li>
        <li>For each game you import, the hours you have played, kept with that game in your list.</li>
        <li>
          The games in your lists, the status, rating and notes you add, and, if you create an account, your email
          address and a scrambled (hashed) password.
        </li>
        <li>
          Your recently played games are kept in the server&apos;s memory for ten minutes to avoid asking Steam again
          and again. They are not saved to the database.
        </li>
      </ul>

      <h2>Who else receives it</h2>
      <ul>
        <li>
          <strong>Steam</strong> receives our requests for your data, and Steam&apos;s sign-in page handles your login.
        </li>
        <li>
          <strong>IGDB</strong> (a service run by Twitch) receives the Steam app numbers of the games you import, so we can
          look up their names, cover art and details.
        </li>
        <li>We do not sell your data, share it with anyone else, or use Steam data for marketing messages.</li>
      </ul>

      <h2>Where it is stored</h2>
      <p>
        {DATA_COUNTRY
          ? `Your data, including your Steam data, is stored on servers in ${DATA_COUNTRY}.`
          : 'The country where your data is stored will be named here when the site is deployed. This copy of the site has not had it set yet.'}
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          <strong>Disconnect Steam</strong> (under Import from Steam on any list page) removes your Steam ID and display
          name from our records.
        </li>
        <li>
          Games and hours you have already imported stay in your lists until you remove the games or delete the list.
          Deleting a list deletes everything in it.
        </li>
        <li>
          {CONTACT_EMAIL ? (
            <>
              To have your whole account and everything in it deleted, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </>
          ) : (
            'To have your whole account deleted, contact details will be given here when the site is deployed.'
          )}
        </li>
      </ul>

      <h2>Steam data is provided &quot;as is&quot;</h2>
      <p>
        Steam data is shown to you &quot;as is&quot; and &quot;as available&quot;, with all faults. It may be wrong, out of date or
        missing, for example because of your Steam privacy settings or because Steam is unavailable. To the fullest
        extent the law allows, Valve, the publishers and developers of Steam games, their suppliers and BacklogVault make
        no promises or warranties about Steam data, including that it is accurate, complete or uninterrupted. To the
        fullest extent the law allows, none of them is liable for any damages, including indirect or consequential
        damages, that arise from using Steam data or this site.
      </p>

      <h2>Not affiliated with Valve</h2>
      <p>
        BacklogVault is an independent project. It is not affiliated with, sponsored by or endorsed by Valve Corporation
        or Steam. Steam and the Steam logo are trademarks of Valve Corporation. Learn more about Steam at{' '}
        <a href="https://store.steampowered.com/" target="_blank" rel="noopener noreferrer">
          store.steampowered.com
        </a>
        .
      </p>

      <h2>Using this site</h2>
      <p>
        Please do not use BacklogVault in any way that breaks the Steam Subscriber Agreement, harms Steam or its games, or
        gives anyone an unfair advantage in a multiplayer game.
      </p>

      <h2>Changes</h2>
      <p>If this page changes in a way that matters, the new version will replace it here.</p>

      <p>
        <Link to="/">&larr; Back to your lists</Link>
      </p>
    </article>
  )
}
