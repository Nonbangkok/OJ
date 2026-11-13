// Reference solution: update the two components IN PLACE with their own +=,
// then hand back *this.
//
// For a std::string component that is the whole point: `second += ...` appends
// into the buffer the string already owns and grows it geometrically, so
// building a string of L characters over q calls costs O(L) in total. The
// version that builds a new pair and assigns it back copies the entire
// accumulated string on every call, which is O(q*L).
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
CP::pair<T1, T2> &CP::pair<T1, T2>::operator+=(const CP::pair<T1, T2> &other)
{
  // Your code here
  first += other.first;
  second += other.second;
  return *this;
}

template <typename T1, typename T2>
CP::pair<T1, T2> &CP::pair<T1, T2>::absorb_twice(const CP::pair<T1, T2> &other)
{
  // You MAY need to edit this function
  *this += other;
  *this += other;
  return *this;
}

#endif
