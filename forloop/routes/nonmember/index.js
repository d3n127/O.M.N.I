/*
 * Non-member portal (/nonmember): students who have not joined an organization yet.
 * Home is defined here; Discover, Apply, Events and RSVP come from ../portal.
 */
const express = require('express');
const { wrap } = require('../../utils');
const { requireRole, requireNonMember, requireStudentInfo } = require('../auth');
const { getOrgs, getUpcomingSummary, addSharedPages } = require('../portal');

const router = express.Router();
router.use(requireRole('student'));
router.use(requireStudentInfo);
router.use(requireNonMember);

async function showHome(req, res) {
  const orgs = await getOrgs(req.session.user.id);
  const upcoming = await getUpcomingSummary();

  res.render('nonmember/home', {
    title: 'Home',
    active: 'home',
    orgs,
    events: upcoming.events,
    cats: [...new Set(orgs.map((o) => o.category))],
    stats: { explore: orgs.length, upcoming: upcoming.total },
  });
}

router.get('/', wrap(showHome));
addSharedPages(router, { view: 'nonmember', base: '/nonmember' });

module.exports = router;
