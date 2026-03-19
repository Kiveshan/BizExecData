import { jest } from '@jest/globals';
import {
  checkAuthenticated,
  checkNotAuthenticated,
  checkAdmin,
  checkRole,
} from '../../middleware/auth.js';

describe('Auth Middleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      isAuthenticated: jest.fn(),
      user: null,
    };
    res = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      render: jest.fn(),
    };
    next = jest.fn();
  });

  describe('checkAuthenticated', () => {
    it('should call next if user is authenticated', () => {
      req.isAuthenticated.mockReturnValue(true);
      checkAuthenticated(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('should redirect to login if user is not authenticated', () => {
      req.isAuthenticated.mockReturnValue(false);
      checkAuthenticated(req, res, next);
      expect(res.redirect).toHaveBeenCalledWith('/login');
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('checkNotAuthenticated', () => {
    it('should redirect to dashboard if user is authenticated', () => {
      req.isAuthenticated.mockReturnValue(true);
      checkNotAuthenticated(req, res, next);
      expect(res.redirect).toHaveBeenCalledWith('/dashboard');
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next if user is not authenticated', () => {
      req.isAuthenticated.mockReturnValue(false);
      checkNotAuthenticated(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  describe('checkAdmin', () => {
    it('should call next if user is admin (roleid 3)', () => {
      req.isAuthenticated.mockReturnValue(true);
      req.user = { roleid: 3 };
      checkAdmin(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should return 403 if user is not admin', () => {
      req.isAuthenticated.mockReturnValue(true);
      req.user = { roleid: 2 };
      checkAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.render).toHaveBeenCalledWith('error', expect.any(Object));
    });

    it('should return 403 if user is not authenticated', () => {
      req.isAuthenticated.mockReturnValue(false);
      checkAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('checkRole', () => {
    it('should call next if user has allowed role', () => {
      req.isAuthenticated.mockReturnValue(true);
      req.user = { roleid: 2 };
      const middleware = checkRole([1, 2, 3]);
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should return 403 if user does not have allowed role', () => {
      req.isAuthenticated.mockReturnValue(true);
      req.user = { roleid: 4 };
      const middleware = checkRole([1, 2, 3]);
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should redirect to login if user is not authenticated', () => {
      req.isAuthenticated.mockReturnValue(false);
      const middleware = checkRole([1, 2, 3]);
      middleware(req, res, next);
      expect(res.redirect).toHaveBeenCalledWith('/login');
    });
  });
});
