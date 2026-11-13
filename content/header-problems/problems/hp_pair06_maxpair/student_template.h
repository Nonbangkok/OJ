#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
const CP::pair<T1, T2> &CP::pair<T1, T2>::larger(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return *this;
}

template <typename T1, typename T2>
const CP::pair<T1, T2> &CP::pair<T1, T2>::larger3(const CP::pair<T1, T2> &b,
                                                  const CP::pair<T1, T2> &c) const
{
  // You MAY need to edit this function
  return larger(b).larger(c);
}

#endif
