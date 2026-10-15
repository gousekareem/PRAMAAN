/** Client-side mirror of the server's personnel class (HG, PC_AR, PC_GENERAL, PC, HC, …). */
export function personnelClassOf(p: {
  personnelCategory: 'POLICE' | 'HOME_GUARD';
  rank: string | null;
  constableCategory: 'AR' | 'GENERAL' | null;
}): string {
  if (p.personnelCategory === 'HOME_GUARD') return 'HG';
  if (p.rank === 'PC') return p.constableCategory ? `PC_${p.constableCategory}` : 'PC';
  return p.rank ?? 'OTHER';
}
