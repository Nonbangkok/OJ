import contestsAdminService from './admin/contestsAdminService';
import problemsAdminService from './admin/problemsAdminService';
import settingsAdminService from './admin/settingsAdminService';
import usersAdminService from './admin/usersAdminService';

const adminService = {
  ...usersAdminService,
  ...problemsAdminService,
  ...contestsAdminService,
  ...settingsAdminService,
};

export default adminService;
