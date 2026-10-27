import { createContext, useContext } from 'react';

const dict = {
  fr: {
    hi: 'Salut', nextShift: 'Prochain quart', comingUp: 'À venir', nothing: "Aucun quart prévu pour l'instant.",
    confirm: 'Confirmer', cantMake: 'Je ne peux pas', toConfirm: 'À confirmer', confirmed: 'Confirmé',
    declined: 'Refusé', booked: 'Réservé', newShift: 'Nouveau quart · à confirmer',
    confirmHint: 'Confirmer te met en vert sur l’horaire. « Je ne peux pas » permet à Ronnie de te remplacer.',
    details: 'Détails', beThereAt: 'Sois là à', minBefore: 'min avant le début', start: 'Début', ends: 'Fin vers',
    where: 'Où', directions: 'Itinéraire', addCal: 'Ajouter au calendrier', wear: 'Tenue et à apporter',
    theEvent: "L'événement", lookFor: 'Repère', yourPosition: 'Ton poste', youAre: 'tu es',
    email: 'Courriel', pin: 'Code à 6 chiffres', next: 'Continuer', login: 'Se connecter',
    firstTime: 'Première connexion ou code oublié ?', sendCode: 'Envoyer un code par courriel',
    codeSent: 'Vérifie tes courriels : touche le lien, ou entre le code reçu.', verify: 'Vérifier', setPin: 'Choisis ton code à 6 chiffres',
    savePin: 'Enregistrer', badLogin: 'Courriel ou code incorrect.', notStaff: "Ce courriel n'est pas dans l'équipe G&R. Parle à Ronnie.",
    logout: 'Déconnexion', back: 'Retour', late: 'En retard ou empêché ? Avertis Ronnie',
  },
  en: {
    hi: 'Hi', nextShift: 'Next shift', comingUp: 'Coming up', nothing: 'No shifts booked yet.',
    confirm: 'Confirm', cantMake: "Can't make it", toConfirm: 'To confirm', confirmed: 'Confirmed',
    declined: 'Declined', booked: 'Booked', newShift: 'New shift · please confirm',
    confirmHint: "Confirm turns you green on the schedule. Can't make it lets Ronnie find a replacement.",
    details: 'Details', beThereAt: 'Be there at', minBefore: 'min before start', start: 'Start', ends: 'Ends about',
    where: 'Where', directions: 'Directions', addCal: 'Add to calendar', wear: 'What to wear and bring',
    theEvent: 'The event', lookFor: 'Look for', yourPosition: 'Your position', youAre: 'you are',
    email: 'Email', pin: '6-digit code', next: 'Continue', login: 'Log in',
    firstTime: 'First time or forgot your code?', sendCode: 'Email me a code',
    codeSent: 'Check your email: tap the link, or enter the code.', verify: 'Verify', setPin: 'Choose your 6-digit code',
    savePin: 'Save', badLogin: 'Wrong email or code.', notStaff: "This email isn't on the G&R team. Talk to Ronnie.",
    logout: 'Log out', back: 'Back', late: "Running late or can't make it? Tell Ronnie",
  },
};

export type Lang = keyof typeof dict;
export type Key = keyof typeof dict.fr;
export const LangContext = createContext<Lang>('fr');
export const useT = () => {
  const lang = useContext(LangContext);
  return (k: Key) => dict[lang][k];
};
export const useLang = () => useContext(LangContext);
